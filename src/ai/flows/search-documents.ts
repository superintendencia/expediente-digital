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

const extractKeywordsPrompt = ai.definePrompt({
  name: 'extractKeywordsPrompt',
  input: { schema: z.object({ query: z.string() }) },
  output: { schema: z.object({ keywords: z.array(z.string()).describe('A list of 1 to 5 keywords extracted from the user query.') }) },
  prompt: `Extract the most relevant keywords from the following user query. Return them as a list of strings.
Query: {{{query}}}`,
});

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
    // 1. Extract keywords from the query
    const { output: keywordsOutput } = await extractKeywordsPrompt({ query: input.query });
    if (!keywordsOutput || keywordsOutput.keywords.length === 0) {
        return {
            results: [],
            answer: "No se pudieron extraer palabras clave de su consulta. Por favor, intente reformularla.",
        };
    }
    
    const keywords = keywordsOutput.keywords;
    
    // Connect to MongoDB
    const client = new MongoClient(input.mongodbUri);

    try {
      await client.connect();
      const db: Db = client.db(input.mongodbDatabaseName);
      const collection = db.collection(input.mongodbCollectionName);

      // 2. Construct a more intelligent search query
      const queryRegexes = keywords.map(keyword => ({ $regex: keyword, $options: 'i' }));
      const queryIn = { $in: keywords.map(keyword => new RegExp(keyword, 'i')) };
      
      let searchQuery = {};
      const orClauses = [];

      const textSearchFields = ['resumen', 'titulo', 'tema'];
      const keywordSearchFields = ['palabras_clave'];

      if (input.documentType === 'regulation') {
        textSearchFields.push('titulo_seccion', 'articulos.resumen_articulo');
        keywordSearchFields.push('articulos.palabras_clave_articulo');
      }

      queryRegexes.forEach(regex => {
        textSearchFields.forEach(field => {
            orClauses.push({ [field]: regex });
        });
      });
      keywordSearchFields.forEach(field => {
        orClauses.push({ [field]: queryIn });
      });

      if (orClauses.length > 0) {
        searchQuery = { $or: orClauses };
      }


      // 3. Search the collection
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
        
        // Ensure all date fields are converted to strings if they exist, otherwise remove them
        for (const key in result) {
          if (result[key] === null) {
            delete result[key];
          } else if (result[key] instanceof Date) {
            result[key] = result[key].toISOString();
          }
        }
        
        if (result.articulos && Array.isArray(result.articulos)) {
          result.articulos = result.articulos.map((articulo: any) => {
            if (articulo.numero_articulo) {
                articulo.numero_articulo = String(articulo.numero_articulo);
            }
            return articulo;
          });
        }
        
        return result;
      });

      // 4. Generate AI response based on results
      const resultsString = JSON.stringify(processedResults, null, 2);

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
