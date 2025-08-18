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


const IntentSchema = z.object({
    intent: z.enum(['search_info', 'count_items', 'unknown']).describe('The user intent.'),
    keywords: z.array(z.string()).optional().describe('Keywords extracted for search_info intent'),
});

const extractIntentPrompt = ai.definePrompt({
  name: 'extractIntentPrompt',
  input: { schema: z.object({ query: z.string() }) },
  output: { schema: IntentSchema },
  prompt: `Analyze the user's query to determine their intent. 
If the user is asking a question to find information, the intent is 'search_info'. Extract the most relevant keywords.
If the user is asking to count something (e.g., "how many articles", "cuántos instructivos"), the intent is 'count_items'.
If the intent is not clear, classify it as 'unknown'.

Query: {{{query}}}`,
});

const generateAnswerPrompt = ai.definePrompt({
  name: 'generateAnswerPrompt',
  input: {
    schema: z.object({
      query: z.string(),
      documentType: z.string(),
      context: z.string(),
    }),
  },
  output: {
    schema: z.object({
      answer: z.string(),
    }),
  },
  prompt: `You are an AI assistant designed to analyze documents and answer user questions.
Answer in Spanish.

User Query: {{{query}}}
Document Type: {{{documentType}}}

Context from Database:
{{{context}}}

Based on the context, provide a concise and informative answer to the user's query. 
If the context contains search results, summarize them and include links ('link_acceso') if available.
If the context is a number, formulate a sentence with that number. For example, if the query was "how many articles" and the context is "45", the answer should be "El reglamento tiene 45 artículos."
If documentType is regulation always return 'https://personal.justucuman.gov.ar/pdf/Reglamento%20de%20Expediente%20Digital.pdf' as link when relevant.
`,
});


// Define the flow
const searchDocumentsFlow = ai.defineFlow(
  {
    name: 'searchDocumentsFlow',
    inputSchema: SearchDocumentsInputSchema,
    outputSchema: SearchDocumentsOutputSchema,
  },
  async input => {
    // 1. Determine user intent
    const { output: intentOutput } = await extractIntentPrompt({ query: input.query });
    if (!intentOutput) {
        return {
            results: [],
            answer: "No pude determinar la intención de su consulta. Por favor, intente reformularla.",
        };
    }
    
    const { intent, keywords } = intentOutput;

    const client = new MongoClient(input.mongodbUri);
    try {
      await client.connect();
      const db: Db = client.db(input.mongodbDatabaseName);
      const collection = db.collection(input.mongodbCollectionName);

      let context = "";
      let results: any[] = [];

      if (intent === 'count_items') {
        let count = 0;
        if (input.documentType === 'regulation') {
            // For regulations, we count the articles within the documents.
            const aggregation = [
                { $unwind: "$articulos" },
                { $count: "total_articles" }
            ];
            const result = await collection.aggregate(aggregation).toArray();
            count = result.length > 0 ? result[0].total_articles : 0;
        } else {
            // For circulars and instructions, we count the documents.
            count = await collection.countDocuments();
        }
        context = String(count);

      } else if (intent === 'search_info') {
        if (!keywords || keywords.length === 0) {
            return {
                results: [],
                answer: "No se pudieron extraer palabras clave de su consulta. Por favor, intente reformularla.",
            };
        }
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
  
        results = await collection.find(searchQuery).toArray();

        if (results.length === 0) {
          return {
            results: [],
            answer: "No se encontraron documentos que coincidan con su búsqueda.",
          };
        }
        context = JSON.stringify(results, null, 2);
      } else { // unknown intent
        return {
            results: [],
            answer: "No estoy seguro de cómo ayudar con eso. Por favor, intente una consulta diferente.",
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

      // 4. Generate AI response based on context
      const { output } = await generateAnswerPrompt({
        query: input.query,
        documentType: input.documentType,
        context: context,
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
