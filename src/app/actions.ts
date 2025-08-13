// @ts-nocheck
'use server';

import { searchDocuments, SearchDocumentsOutput } from '@/ai/flows/search-documents';
import { z } from 'zod';

const formSchema = z.object({
  query: z.string().min(1, 'Query is required.'),
  documentType: z.enum(['circular', 'instruction', 'regulation']),
  mongodbUri: z.string().min(1, 'MongoDB URI is required.'),
  mongodbDatabaseName: z.string().min(1, 'Database name is required.'),
});

export interface SearchState {
  data?: SearchDocumentsOutput;
  error?: string;
  formErrors?: Record<string, string[] | undefined>;
}

const collectionMap: Record<'circular' | 'instruction' | 'regulation', string> = {
  circular: 'circulares',
  instruction: 'instructivos',
  regulation: 'reglamentos',
};

export async function handleSearch(
  prevState: SearchState,
  formData: FormData
): Promise<SearchState> {
  const rawFormData = {
    query: formData.get('query'),
    documentType: formData.get('documentType'),
    mongodbUri: formData.get('mongodbUri'),
    mongodbDatabaseName: formData.get('mongodbDatabaseName'),
  };

  const parsed = formSchema.safeParse(rawFormData);

  if (!parsed.success) {
    return { error: 'Invalid form data.', formErrors: parsed.error.flatten().fieldErrors };
  }

  const { query, documentType, mongodbUri, mongodbDatabaseName } = parsed.data;

  try {
    const collectionName = collectionMap[documentType];
    const result = await searchDocuments({
      query,
      documentType,
      mongodbUri,
      mongodbDatabaseName,
      mongodbCollectionName: collectionName,
    });
    return { data: result };
  } catch (e: any) {
    console.error(e);
    return { error: e.message || 'An unexpected error occurred.' };
  }
}
