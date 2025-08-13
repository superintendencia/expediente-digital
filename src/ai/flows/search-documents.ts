'use server';

/**
 * @fileOverview This file defines a Genkit flow for searching documents (circulars, instructions, and regulations)
 * in a MongoDB Atlas database based on keywords and then analyzing and responding to user queries.
 *
 * - searchDocuments - A function that handles the document search process.
 * - SearchDocumentsInput - The input type for the searchDocuments function.
 * - SearchDocumentsOutput - The return type for the searchDocuments function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';
import {MongoClient, Db} from 'mongodb';

// Define the input schema
const SearchDocumentsInputSchema = z.object({
  query: z.string().describe('The user query to search for documents.'),
  documentType: z.enum(['circular', 'instruction', 'regulation']).describe('The type of document to search for.'),
  mongodbUri: z.string().describe('The MongoDB connection URI.'),
  mongodbDatabaseName: z.string().describe('The name of the MongoDB database.'),
  mongodbCollectionName: z.string().describe('The name of the MongoDB collection.'),
});
export type SearchDocumentsInput = z.infer<typeof SearchDocumentsInputSchema>;

// Define the output schema
const SearchDocumentsOutputSchema = z.object({
  results: z.array(
    z.object({
      _id: z.any(),
      link_acceso: z.string().optional(),
      resumen: z.string().optional(),
      titulo: z.string().optional(),
      tipo_normativa: z.string().optional(),
      numero: z.string().optional(),
      tema: z.string().optional(),
      palabras_clave: z.array(z.string()).optional(),
      fecha_expedicion: z.string().optional(),
      titulo_seccion: z.string().optional(),
      articulos: z
        .array(
          z.object({
            numero_articulo: z.string().optional(),
            resumen_articulo: z.string().optional(),
            palabras_clave_articulo: z.array(z.string()).optional(),
          })
        )
        .optional(),
    })
  ).describe('The search results from the database.'),
  answer: z.string().describe('The answer to the user query based on the search results.'),
});
export type SearchDocumentsOutput = z.infer<typeof SearchDocumentsOutputSchema>;

// Define the main function that will be called from the client
export async function searchDocuments(input: SearchDocumentsInput): Promise<SearchDocumentsOutput> {
  return searchDocumentsFlow(input);
}

// Define the prompt
const searchDocumentsPrompt = ai.definePrompt({
  name: 'searchDocumentsPrompt',
  input: {
    schema: z.object({
      query: z.string(),
      documentType: z.string(),
      results: z.string(),
    }),
  },
  output: {
    schema: z.object({
      answer: z.string(),
    }),
  },
  prompt: `You are an AI assistant designed to search and analyze documents from a database.

You will be provided with a user query, the type of document to search for (circular, instruction, or regulation), and the search results from the database.

Your task is to:
1.  Analyze the retrieved documents and provide a concise and informative answer to the user query.
2.  If a document has a 'link_acceso', include it in your answer.
3.  If documentType is regulation always return 'https://personal.justucuman.gov.ar/pdf/Reglamento%20de%20Expediente%20Digital.pdf' as link.
4.  Do not use any external sources or hallucinate information.
5.  Answer in Spanish.

Here is the information you will use:

User Query: {{{query}}}
Document Type: {{{documentType}}}

Here are the search results from the database:
{{{results}}}


Answer:`,
});

// Define the flow
const searchDocumentsFlow = ai.defineFlow(
  {
    name: 'searchDocumentsFlow',
    inputSchema: SearchDocumentsInputSchema,
    outputSchema: SearchDocumentsOutputSchema,
  },
  async input => {
    // Connect to MongoDB
    const client = new MongoClient(input.mongodbUri);

    try {
      await client.connect();
      const db: Db = client.db(input.mongodbDatabaseName);
      const collection = db.collection(input.mongodbCollectionName);

      // Construct the search query based on the document type
      const queryRegex = { $regex: input.query, $options: 'i' };
      const queryIn = { $in: [new RegExp(input.query, 'i')] };

      let searchQuery = {};
      const orClauses = [];
      
      if (input.documentType === 'regulation') {
        orClauses.push(
          { 'articulos.palabras_clave_articulo': queryIn },
          { 'articulos.resumen_articulo': queryRegex },
          { titulo_seccion: queryRegex },
        );
      } else {
         orClauses.push(
            { palabras_clave: queryIn },
            { resumen: queryRegex },
            { titulo: queryRegex },
        );
      }

      if (orClauses.length > 0) {
        searchQuery = { $or: orClauses };
      }


      // Search the collection
      const results = await collection.find(searchQuery).toArray();

      if (results.length === 0) {
        return {
          results: [],
          answer: "No se encontraron documentos que coincidan con su búsqueda.",
        };
      }

      // Process results before sending them to the prompt or returning them
      const processedResults = results.map(r => {
        const result: any = { ...r, _id: r._id.toString() };
        if (r.fecha_expedicion && r.fecha_expedicion instanceof Date) {
          result.fecha_expedicion = r.fecha_expedicion.toISOString();
        }
        return result;
      });

      // Serializa resultados a string JSON para el prompt
      const resultsString = JSON.stringify(processedResults, null, 2);

      // Pasa la cadena serializada al prompt
      const { output } = await searchDocumentsPrompt({
        query: input.query,
        documentType: input.documentType,
        results: resultsString,
      });

      return {
        results: processedResults,
        answer: output?.answer || "No pude generar una respuesta basada en los documentos proporcionados.",
      };
    } finally {
      await client.close();
    }
  }
);
