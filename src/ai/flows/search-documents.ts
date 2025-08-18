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
  mongodbUri: z.string().describe('The MongoDB connection URI.'),
  mongodbDatabaseName: z.string().describe('The name of the MongoDB database.'),
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

const collectionMap: Record<'circular' | 'instruction' | 'regulation', string> = {
  circular: 'circulares',
  instruction: 'instructivos',
  regulation: 'reglamentos',
};

const IntentSchema = z.object({
    intent: z.enum(['search_info', 'count_items', 'unknown']).describe('The user intent.'),
    documentType: z.enum(['circular', 'instruction', 'regulation', 'all']).optional().describe('The type of document the user is asking about. "all" if not specified.'),
    keywords: z.array(z.string()).optional().describe('Keywords extracted for search_info intent'),
});

const extractIntentPrompt = ai.definePrompt({
  name: 'extractIntentPrompt',
  input: { schema: z.object({ query: z.string() }) },
  output: { schema: IntentSchema },
  prompt: `Analyze the user's query to determine their intent and the type of document they are interested in.
The document types can be 'circular', 'instruction', or 'regulation'. If no specific type is mentioned, classify it as 'all'.
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
Answer in Spanish. Your response must be clear, concise, and well-formatted.

User Query: {{{query}}}
Document Type: {{{documentType}}}

Context from Database:
{{{context}}}

Based on the context, provide a comprehensive answer. Follow these rules:
1.  **Format your response using Markdown.** Use lists, bold text, and other elements to improve readability.
2.  **Specify the source.** When you extract information, always clarify if it comes from a **circular**, an **instructivo**, or the **reglamento de expediente digital**. For example: "Según la **Circular 05/20**..." or "El **artículo 25 del reglamento de expediente digital** establece que...".
3.  **Summarize findings.** If the context contains multiple search results, summarize them in a structured way, like a list. Include links ('link_acceso') if available for each item.
4.  **Handle counts.** If the context is a number (because the user asked to count something), formulate a natural language sentence. For example, if the query was "¿cuántos artículos tiene el reglamento?" and the context is "116", the answer should be "El **reglamento de expediente digital** tiene un total de 116 artículos."
5.  **Provide the main regulation link.** If the 'documentType' is 'regulation', always include the link 'https://personal.justucuman.gov.ar/pdf/Reglamento%20de%20Expediente%20Digital.pdf' when relevant.
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
    // 1. Determine user intent and document type
    const { output: intentOutput } = await extractIntentPrompt({ query: input.query });
    if (!intentOutput) {
        return {
            results: [],
            answer: "No pude determinar la intención de su consulta. Por favor, intente reformularla.",
        };
    }
    
    const { intent, documentType = 'all', keywords } = intentOutput;

    const client = new MongoClient(input.mongodbUri);
    try {
      await client.connect();
      const db: Db = client.db(input.mongodbDatabaseName);
      
      let context = "";
      let results: any[] = [];
      let finalAnswerDocumentType = documentType;

      const collectionsToQuery = documentType === 'all'
        ? Object.values(collectionMap)
        : [collectionMap[documentType as 'circular' | 'instruction' | 'regulation']];
      
      if (intent === 'count_items') {
        let totalCount = 0;
        for (const collectionName of collectionsToQuery) {
          const collection = db.collection(collectionName);
          if (collectionName === 'reglamentos') {
              const aggregation = [
                  { $unwind: "$articulos" },
                  { $count: "total_articles" }
              ];
              const result = await collection.aggregate(aggregation).toArray();
              totalCount += result.length > 0 ? result[0].total_articles : 0;
          } else {
              totalCount += await collection.countDocuments();
          }
        }
        context = String(totalCount);

      } else if (intent === 'search_info') {
        if (!keywords || keywords.length === 0) {
            return {
                results: [],
                answer: "No se pudieron extraer palabras clave de su consulta. Por favor, intente reformularla.",
            };
        }
        
        const queryRegexes = keywords.map(keyword => ({ $regex: keyword, $options: 'i' }));
        const queryIn = { $in: keywords.map(keyword => new RegExp(keyword, 'i')) };
        
        for (const collectionName of collectionsToQuery) {
            const collection = db.collection(collectionName);
            let searchQuery = {};
            const orClauses = [];

            const isRegulation = collectionName === 'reglamentos';

            const textSearchFields = ['resumen', 'titulo', 'tema'];
            const keywordSearchFields = ['palabras_clave'];
    
            if (isRegulation) {
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
    
            const collectionResults = await collection.find(searchQuery).toArray();
            results = results.concat(collectionResults);
        }

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
        
        Object.keys(result).forEach(key => {
            if (result[key] === null) {
              delete result[key];
            } else if (result[key] instanceof Date) {
              result[key] = result[key].toISOString();
            }
        });
        
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
        documentType: finalAnswerDocumentType,
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
