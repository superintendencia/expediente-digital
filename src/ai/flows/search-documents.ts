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
import {z} from 'zod';
import {MongoClient, Db} from 'mongodb';

// Define the input schema
const SearchDocumentsInputSchema = z.object({
  query: z.string().describe('The user query to search for documents.'),
  mongodbUri: z.string().describe('The MongoDB connection URI.'),
  mongodbDatabaseName: z.string().describe('The name of the MongoDB database.'),
});
export type SearchDocumentsInput = z.infer<typeof SearchDocumentsInputSchema>;

const EntidadAfectadaSchema = z.object({
    nombre_entidad: z.string().optional(),
    tipo: z.string().optional(),
    tipo_entidad: z.string().optional(),
});

// Define the output schema
const SearchDocumentsOutputSchema = z.object({
  results: z.array(
    z.object({
      _id: z.any(),
      link_de_acceso: z.string().optional(),
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
        entidades_afectadas: z.array(EntidadAfectadaSchema).optional(),
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
    intent: z.enum(['search_info', 'count_items', 'search_latest', 'unknown']).describe('The user intent.'),
    documentType: z.enum(['circular', 'instruction', 'regulation', 'all']).optional().describe('The type of document the user is asking about. "all" if not specified.'),
    keywords: z.array(z.string()).optional().describe('Keywords extracted for search_info or count_items intent'),
    year: z.number().optional().describe('A year mentioned in the query, if any (e.g., 2023).'),
    instructivoType: z.enum(['interno', 'externo', 'ambos']).optional().describe('For search_latest intent on instructions, specifies if the user wants "interno", "externo" or both.'),
});

const extractIntentPrompt = ai.definePrompt({
  name: 'extractIntentPrompt',
  input: { schema: z.object({ query: z.string() }) },
  output: { schema: IntentSchema },
  prompt: `Analyze the user's query to determine their intent and the type of document they are interested in.
The document types can be 'circular', 'instruction', or 'regulation'. If no specific type is mentioned, classify it as 'all'.
If the user is asking a question to find information, the intent is 'search_info'. Extract the most relevant keywords.
If the user is asking to count something (e.g., "how many articles", "cuántos instructivos"), the intent is 'count_items'. Also extract keywords if the count is conditioned (e.g., "cuántas circulares sobre superintendencia").
If the user is asking for the "latest" or "newest" document (e.g., "cuál es el último instructivo", "el instructivo más reciente"), the intent is 'search_latest' and the documentType should be 'instruction'. For this intent, also determine if they are asking for "interno", "externo" or both (if not specified, it's "ambos").
If a year is mentioned (e.g., "del año 2023", "en 2022"), extract it into the 'year' field.
If the user is asking for a specific circular by its number (e.g., "circular 06/20"), extract the number "06/20" as a keyword.
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
      intent: z.enum(['search_info', 'count_items', 'search_latest', 'unknown']),
      resultsCount: z.number().optional(),
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
User Intent: {{{intent}}}
Total Results Found: {{{resultsCount}}}

Context from Database:
{{{context}}}

Based on the context, provide a comprehensive answer. Follow these rules:
1.  **Format your response using Markdown.** Use lists, bold text, and other elements to improve readability.
2.  **Specify the source.** When you extract information, always clarify if it comes from a **circular**, an **instructivo**, or the **reglamento de expediente digital**. For example: "Según la **Circular 05/20**..." or "El **artículo 25 del reglamento de expediente digital** establece que...".
3.  **Handle listings and summaries (search_info or count_items intent):**
    *   If the context contains a list of documents, summarize them in a structured way, like a list. This is more helpful than just counting them if the list is not excessively long.
    *   For each item, include its title (or number) and a brief summary.
    *   If a link ('link_de_acceso') is available, include it using the Markdown format: **[Ver documento](URL_DEL_LINK)**. Do not just paste the URL.
    *   If the context is just a number (the result of a count), formulate a natural language sentence. For example, if the query was "¿cuántos artículos tiene el reglamento?" and the context is "116", the answer should be "El **reglamento de expediente digital** tiene un total de 116 artículos."
4.  **Provide the main regulation link.** If the 'documentType' is 'regulation' or the context mentions it, always include the link 'https://personal.justucuman.gov.ar/pdf/Reglamento%20de%20Expediente%20Digital.pdf' when relevant, using the anchor text "Ver reglamento completo".
5.  **Handle long lists.** If you determine the list of documents in the context is too long to display fully, you MUST add a note at the end of your response, such as: "Se han encontrado más documentos que coinciden con su búsqueda. Puede ver la lista completa en la pestaña 'Documentos Fuente'." The total number of documents found is {{{resultsCount}}}. Use this to decide if you need to add the warning.
6.  **Clarification on "Instructivos"**: When the user asks about instructivos, note that their titles follow the format "XY - Título", where 'X' can be 'I' (interno) or 'E' (externo), and 'Y' is the instructivo number. The higher the number, the more recent the instructivo. Mention this if it helps clarify a user's question about the latest versions.
7.  **Handle ambiguous queries.** If the search results are too broad or the user's question is ambiguous, ask for more details to narrow down the search. For example: "Su búsqueda arrojó muchos resultados. ¿Podría especificar el año o el tema que le interesa para poder darle una respuesta más precisa?".
8.  **Citing the Regulation:** The regulation is structured into sections ('titulo_seccion') which contain multiple articles ('articulos'). When citing the regulation, be as specific as possible. Mention the article number and, if possible, the section title for better context. For example: "El **artículo 25** de la sección **TÍTULO VII: COMUNICACIONES** del reglamento establece que...".
9.  **Understanding Circular Numbers:** Be aware that the 'numero' field for circulares follows a 'number/year' format (e.g., "04/23" is circular number 4 from the year 2023). Use this understanding when interpreting and presenting information.
10. **Handling "How-To" Questions:** If the user query starts with "cómo" or is asking for instructions, and the most relevant result is an 'instructivo', you should provide a step-by-step guide based on the 'resumen' field of that 'instructivo'. Format the steps clearly using a numbered list.
11. **Handling Entities in Circulars:** If a circular contains information about 'entidades_afectadas', clearly state the entity's name, the type of change (ALTA, BAJA, MODIFICACION), and the type of entity in your response. This adds valuable context.
`,
});

const buildSearchQuery = (keywords: string[], documentType: 'circular' | 'instruction' | 'regulation' | 'all', year?: number) => {
    const andConditions: any[] = [];
    const circularNumberRegex = /^\d{1,2}\/\d{2}$/;
    const circularNumberKeyword = keywords.find(k => circularNumberRegex.test(k));

    // High-precision search for a specific circular number
    if (circularNumberKeyword && (documentType === 'circular' || documentType === 'all')) {
        return {
            tipo_normativa: { $regex: "CIRCULAR", $options: 'i' },
            numero: circularNumberKeyword
        };
    }

    // 1. Keyword search logic
    if (keywords && keywords.length > 0) {
        keywords.forEach(keyword => {
            const regex = { $regex: keyword, $options: 'i' };
            const orClausesForKeyword: any[] = [];
            
            let textSearchFields: string[] = [];
            const documentTypesToQuery = documentType === 'all' ? ['circular', 'instruction', 'regulation'] : [documentType];

            if (documentTypesToQuery.includes('circular')) {
                textSearchFields.push(
                    'tipo_normativa', 'numero', 'resumen', 'tema', 'palabras_clave',
                    'entidades_afectadas.nombre_entidad', 'entidades_afectadas.tipo', 'entidades_afectadas.tipo_entidad'
                );
            }
            if (documentTypesToQuery.includes('instruction')) {
                textSearchFields.push('titulo', 'resumen', 'palabras_clave', 'tipo_normativa');
            }
            if (documentTypesToQuery.includes('regulation')) {
                textSearchFields.push('titulo_seccion', 'articulos.resumen_articulo', 'articulos.palabras_clave_articulo');
            }
            
            const uniqueTextSearchFields = [...new Set(textSearchFields)];

            uniqueTextSearchFields.forEach(field => {
                orClausesForKeyword.push({ [field]: regex });
            });
            
            if (orClausesForKeyword.length > 0) {
                andConditions.push({ $or: orClausesForKeyword });
            }
        });
    }

    // 2. Year search logic
    if (year) {
        const yearShort = year.toString().slice(-2); // e.g., 23
        const yearLong = year.toString(); // e.g., 2023

        const yearOrConditions: any[] = [
            { fecha_expedicion: { $regex: `^${yearLong}`, $options: 'i' } }
        ];

        const documentTypesForYearQuery = documentType === 'all' ? ['circular'] : (documentType === 'circular' ? ['circular'] : []);
        if (documentTypesForYearQuery.includes('circular')) {
             yearOrConditions.push({ 
                $and: [
                    { tipo_normativa: { $regex: "CIRCULAR", $options: 'i' } },
                    { numero: { $regex: `/${yearShort}$`, $options: 'i' } }
                ]
            });
        }
        
        andConditions.push({ $or: yearOrConditions });
    }
    
    // Combine all "AND" conditions
    if (andConditions.length === 0) return {};
    if (andConditions.length === 1) return andConditions[0];
    return { $and: andConditions };
};


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
    
    const { intent, documentType = 'all', keywords, year, instructivoType } = intentOutput;

    if (intent === 'unknown' || (intent !== 'search_latest' && (!keywords || keywords.length === 0) && !year)) {
      if (input.query.toLowerCase().includes('hola')) {
         return { results: [], answer: "¡Hola! Soy Digitalius, tu asistente de IA para la búsqueda de documentos. ¿En qué puedo ayudarte hoy?" };
      }
      return {
        results: [],
        answer: "No estoy seguro de cómo ayudar con eso. Por favor, intente una consulta diferente o más específica.",
      };
    }
    
    const client = new MongoClient(input.mongodbUri);
    try {
      await client.connect();
      const db: Db = client.db(input.mongodbDatabaseName);
      
      let context = "";
      let results: any[] = [];
      let finalAnswerDocumentType = documentType;

      if (intent === 'search_latest' && documentType === 'instruction') {
        const collection = db.collection(collectionMap.instruction);
        
        const getNumber = (title: string) => {
            const match = title.match(/^[IE](\d+)/);
            return match ? parseInt(match[1], 10) : 0;
        };

        const findLatest = async (type: 'I' | 'E') => {
            const instructivos = await collection.find({ titulo: { $regex: `^${type}` } }).toArray();
            if (instructivos.length === 0) return null;

            instructivos.sort((a, b) => getNumber(b.titulo || '') - getNumber(a.titulo || ''));
            return instructivos[0];
        };

        if (instructivoType === 'interno') {
            const latest = await findLatest('I');
            if (latest) results.push(latest);
        } else if (instructivoType === 'externo') {
            const latest = await findLatest('E');
            if (latest) results.push(latest);
        } else { // 'ambos' or undefined
            const latestI = await findLatest('I');
            const latestE = await findLatest('E');
            if (latestI) results.push(latestI);
            if (latestE) results.push(latestE);
        }

        finalAnswerDocumentType = 'instruction';
      } else {
        const collectionsToQuery = documentType === 'all'
          ? Object.values(collectionMap)
          : [collectionMap[documentType as 'circular' | 'instruction' | 'regulation']];
        
        for (const collectionName of collectionsToQuery) {
            const collection = db.collection(collectionName);
            const docTypeForQuery = Object.keys(collectionMap).find(key => collectionMap[key as 'circular' | 'instruction' | 'regulation'] === collectionName) as 'circular' | 'instruction' | 'regulation';
            
            // Build query only for the specific document type being queried
            const query = buildSearchQuery(keywords || [], docTypeForQuery, year);
            
            const collectionResults = await collection.find(query).toArray();
            results = results.concat(collectionResults);
        }
      }

      if (results.length === 0) {
        return {
          results: [],
          answer: "No se encontraron documentos que coincidan con su búsqueda.",
        };
      }
      
      // Remove duplicates based on _id
      const uniqueResults = results.filter((result, index, self) =>
        index === self.findIndex((r) => (
          r._id.toString() === result._id.toString()
        ))
      );

      // Sanitize `palabras_clave` to ensure it's an array
      uniqueResults.forEach(result => {
        if (typeof result.palabras_clave === 'string') {
          result.palabras_clave = result.palabras_clave.split(',').map((s: string) => s.trim());
        }
      });
      
      context = JSON.stringify(uniqueResults, null, 2);

      // Process results before sending them to the prompt or returning them
      const processedResults = uniqueResults.map(r => {
        const result: any = { ...r, _id: r._id.toString() };
        
        Object.keys(result).forEach(key => {
            if (result[key] === null || result[key] === undefined) {
              delete result[key];
            } else if (result[key] instanceof Date) {
              result[key] = result[key].toISOString();
            }
        });
        
        if (result.articulos && Array.isArray(result.articulos)) {
          result.articulos = result.articulos.map((articulo: any) => {
            if (articulo && typeof articulo === 'object' && articulo.numero_articulo) {
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
        intent: intent,
        resultsCount: processedResults.length,
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
