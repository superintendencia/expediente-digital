// @ts-nocheck
'use server';

import { searchDocuments, SearchDocumentsOutput } from '@/ai/flows/search-documents';
import { z } from 'zod';

const formSchema = z.object({
  query: z.string().min(1, 'La consulta es obligatoria.'),
  mongodbUri: z.string().min(1, 'El URI de MongoDB es obligatorio.'),
  mongodbDatabaseName: z.string().min(1, 'El nombre de la base de datos es obligatorio.'),
});

export interface SearchState {
  data?: SearchDocumentsOutput;
  error?: string;
  formErrors?: Record<string, string[] | undefined>;
}

export async function handleSearch(
  prevState: SearchState,
  formData: FormData
): Promise<SearchState> {
  const rawFormData = {
    query: formData.get('query'),
    mongodbUri: formData.get('mongodbUri'),
    mongodbDatabaseName: formData.get('mongodbDatabaseName'),
  };

  const parsed = formSchema.safeParse(rawFormData);

  if (!parsed.success) {
    return { error: 'Datos de formulario inválidos.', formErrors: parsed.error.flatten().fieldErrors };
  }

  const { query, mongodbUri, mongodbDatabaseName } = parsed.data;

  try {
    const result = await searchDocuments({
      query,
      mongodbUri,
      mongodbDatabaseName,
    });
    return { data: result };
  } catch (e: any) {
    console.error(e);
    return { error: e.message || 'Ocurrió un error inesperado.' };
  }
}
