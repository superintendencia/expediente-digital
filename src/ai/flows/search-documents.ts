'use server';

/**
 * @fileOverview This file defines a Genkit flow for analyzing and responding to user queries
 * based on a provided context of documents. The database access is handled separately.
 *
 * - searchDocuments - A function that handles the document analysis process.
 * - SearchDocumentsInput - The input type for the searchDocuments function.
 * - SearchDocumentsOutput - The return type for the searchDocuments function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'zod';

const IntentSchema = z.object({
    intent: z.enum(['search_info', 'count_items', 'search_latest', 'unknown']).describe('The user intent.'),
    documentType: z.enum(['circular', 'instruction', 'regulation', 'all']).optional().describe('The type of document the user is asking about. "all" if not specified.'),
    keywords: z.array(z.string()).optional().describe('Keywords extracted for search_info or count_items intent'),
    year: z.number().optional().describe('A year mentioned in the query, if any (e.g., 2023).'),
    instructivoType: z.enum(['interno', 'externo', 'ambos']).optional().describe('For search_latest intent on instructions, specifies if the user wants "interno", "externo" or both (if not specified, it\'s "ambos").'),
});

// Define the input schema
const SearchDocumentsInputSchema = z.object({
  query: z.string().describe('The user query to search for documents.'),
  context: z.string().optional().describe('JSON string of documents from the database.'),
  intentAnalysis: IntentSchema.optional().describe('Pre-computed intent analysis.'),
  dbResults: z.array(z.any()).optional().describe('Raw results from the database to be passed through to the client.'),
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
  ).describe('The search results from the database.').optional(),
  answer: z.string().describe('The answer to the user query based on the search results.'),
  requiresContext: z.boolean().optional().describe('If true, the caller needs to fetch context and call again.'),
  intentAnalysis: IntentSchema.optional().describe('The result of the intent analysis.'),
});
export type SearchDocumentsOutput = z.infer<typeof SearchDocumentsOutputSchema>;

// Define the main function that will be called from the client
export async function searchDocuments(input: SearchDocumentsInput): Promise<SearchDocumentsOutput> {
  return searchDocumentsFlow(input);
}

const extractIntentPrompt = ai.definePrompt({
  name: 'extractIntentPrompt',
  input: { schema: z.object({ query: z.string() }) },
  output: { schema: IntentSchema },
  prompt: `Analyze the user's query to determine their intent and the type of document they are interested in.
The document types can be 'circular', 'instruction', or 'regulation'. If no specific type is mentioned, classify it as 'all'.
If the user is asking a question to find information, the intent is 'search_info'. Extract the most relevant keywords.
If the user is asking to count something (e.g., "how many articles", "cuántos instructivos"), the intent is 'count_items'. Also extract keywords if the count is conditioned (e.g., "cuántas circulares sobre superintendencia").
If the user is asking for the "latest" or "newest" document (e.g., "cuál es el último instructivo", "la circular más reciente"), the intent is 'search_latest'. Determine the documentType ('instruction' or 'circular'). For 'instruction' intent, also determine if they are asking for "interno", "externo" or both (if not specified, it's "ambos").
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


// Define the flow
const searchDocumentsFlow = ai.defineFlow(
  {
    name: 'searchDocumentsFlow',
    inputSchema: SearchDocumentsInputSchema,
    outputSchema: SearchDocumentsOutputSchema,
  },
  async (input) => {
    // If context is provided, it means we have DB results and can generate the final answer.
    if (input.context) {
        const intentAnalysis = input.intentAnalysis!;
        const context = input.context;
        const dbResults = input.dbResults || [];

        if (dbResults.length === 0) {
            return {
                results: [],
                answer: "No se encontraron documentos que coincidan con su búsqueda.",
            };
        }

        const { output } = await generateAnswerPrompt({
            query: input.query,
            documentType: intentAnalysis.documentType || 'all',
            context: context,
            intent: intentAnalysis.intent,
            resultsCount: dbResults.length,
        });

        return {
            results: dbResults,
            answer: output?.answer || "No pude generar una respuesta basada en los documentos proporcionados.",
        };
    }

    // First call: Analyze intent and tell the caller to fetch context.
    const { output: intentOutput } = await extractIntentPrompt({ query: input.query });
    
    if (!intentOutput) {
        return {
            answer: "No pude determinar la intención de su consulta. Por favor, intente reformularla.",
        };
    }
    
    const { intent, keywords } = intentOutput;

    if (intent === 'unknown' || (intent !== 'search_latest' && (!keywords || keywords.length === 0) && !intentOutput.year)) {
        if (input.query.toLowerCase().includes('hola')) {
            return { results: [], answer: "¡Hola! Soy Digitalius, tu asistente de IA para la búsqueda de documentos. ¿En qué puedo ayudarte hoy?" };
        }
        return {
            answer: "No estoy seguro de cómo ayudar con eso. Por favor, intente una consulta diferente o más específica.",
        };
    }

    // Signal to the server action that it needs to fetch context
    return {
        answer: '', // No answer yet
        requiresContext: true,
        intentAnalysis: intentOutput,
    };
  }
);
