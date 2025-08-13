'use server';
/**
 * @fileOverview An AI agent that answers questions based on the content of circulars, instructions, and regulations fetched from a MongoDB database.
 *
 * - answerQueries - A function that handles the question answering process.
 * - AnswerQueriesInput - The input type for the answerQueries function.
 * - AnswerQueriesOutput - The return type for the answerQueries function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const AnswerQueriesInputSchema = z.object({
  query: z.string().describe('The user question about circulars, instructions, or regulations.'),
  documentType: z.enum(['circular', 'instruction', 'regulation']).describe('The type of document to search in.'),
  documentContent: z.string().describe('The content of the documents found from MongoDB Atlas'),
});
export type AnswerQueriesInput = z.infer<typeof AnswerQueriesInputSchema>;

const AnswerQueriesOutputSchema = z.object({
  answer: z.string().describe('The answer to the user question based on the content of the documents.'),
  link: z.string().optional().describe('The link to the original document, if available.'),
});
export type AnswerQueriesOutput = z.infer<typeof AnswerQueriesOutputSchema>;

export async function answerQueries(input: AnswerQueriesInput): Promise<AnswerQueriesOutput> {
  return answerQueriesFlow(input);
}

const prompt = ai.definePrompt({
  name: 'answerQueriesPrompt',
  input: {schema: AnswerQueriesInputSchema},
  output: {schema: AnswerQueriesOutputSchema},
  prompt: `You are an AI assistant that answers questions based on the content of internal documents.
  You are connected to a database containing circulars, instructions, and regulations.
  You must not use any external sources or alucinate information.

  The user is asking a question about a specific type of document.
  The relevant documents from the database are provided below. Analyze them to answer the question.

  User question: {{{query}}}
  Document type: {{{documentType}}}
  Document content: {{{documentContent}}}

  When providing the answer, include a link to the original document if available.
  If the user asks for complete information about a circular, instruction, or regulation, provide the corresponding link.
  The link for the reglamento is https://personal.justucuman.gov.ar/pdf/Reglamento%20de%20Expediente%20Digital.pdf.
`,
});

const answerQueriesFlow = ai.defineFlow(
  {
    name: 'answerQueriesFlow',
    inputSchema: AnswerQueriesInputSchema,
    outputSchema: AnswerQueriesOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    return output!;
  }
);
