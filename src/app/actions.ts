// @ts-nocheck
'use server';

import { searchDocuments, SearchDocumentsOutput } from '@/ai/flows/search-documents';
import { z } from 'zod';

const formSchema = z.object({
  query: z.string().min(1, 'La consulta es obligatoria.'),
  documentType: z.enum(['circular', 'instruction', 'regulation']),
  mongodbUri: z.string().min(1, 'El URI de MongoDB es obligatorio.'),
  mongodbDatabaseName: z.string().min(1, 'El nombre de la base de datos es obligatorio.'),
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
    return { error: 'Datos de formulario inválidos.', formErrors: parsed.error.flatten().fieldErrors };
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
    return { error: e.message || 'Ocurrió un error inesperado.' };
  }
}
