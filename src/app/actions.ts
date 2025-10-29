// @ts-nocheck
'use server';

import { searchDocuments, SearchDocumentsOutput } from '@/ai/flows/search-documents';
import { z } from 'zod';

// Define a schema for the form data, now only containing the query.
const formSchema = z.object({
  query: z.string().min(1, 'La consulta es obligatoria.').max(500, 'La consulta no puede exceder los 500 caracteres.'),
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
  };

  const parsed = formSchema.safeParse(rawFormData);

  if (!parsed.success) {
    return { error: 'Datos de formulario inválidos.', formErrors: parsed.error.flatten().fieldErrors };
  }

  const { query } = parsed.data;

  // Database credentials are now read from server-side environment variables.
  const mongodbUri = process.env.MONGODB_URI;
  const mongodbDatabaseName = process.env.MONGODB_DATABASE_NAME;

  if (!mongodbUri || !mongodbDatabaseName) {
    console.error('Las variables de entorno de MongoDB no están configuradas en el servidor.');
    return { error: 'La configuración del servidor está incompleta. Por favor, contacta al administrador.' };
  }

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
