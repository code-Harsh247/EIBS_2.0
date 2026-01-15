/**
 * Supabase Server-side Client
 * 
 * Uses SUPABASE_SERVICE_ROLE_KEY for server-side operations
 * including private bucket access for PDF storage.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// Validate configuration
if (!supabaseUrl) {
  console.warn('NEXT_PUBLIC_SUPABASE_URL is not configured');
}

if (!supabaseServiceRoleKey) {
  console.warn('SUPABASE_SERVICE_ROLE_KEY is not configured');
}

// Server-side client with service role key (bypasses RLS)
// ONLY use this on the server side, never expose to client
export const supabaseAdmin: SupabaseClient = createClient(
  supabaseUrl,
  supabaseServiceRoleKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

// Storage bucket name for invoice PDFs
export const INVOICE_PDF_BUCKET = 'private-invoices';

/**
 * Check if Supabase is properly configured
 */
export function isSupabaseConfigured(): boolean {
  return !!(supabaseUrl && supabaseServiceRoleKey);
}

/**
 * Upload a PDF file to Supabase Storage
 * @param buffer - PDF file buffer
 * @param fileName - Name for the file in storage
 * @returns Upload result with path or error
 */
export async function uploadPdfToStorage(
  buffer: Buffer,
  fileName: string
): Promise<{
  success: boolean;
  path?: string;
  error?: string;
}> {
  if (!isSupabaseConfigured()) {
    return { success: false, error: 'Supabase is not configured' };
  }

  try {
    const { data, error } = await supabaseAdmin.storage
      .from(INVOICE_PDF_BUCKET)
      .upload(fileName, buffer, {
        contentType: 'application/pdf',
        upsert: true, // Overwrite if exists
      });

    if (error) {
      console.error('Supabase upload error:', error);
      return { success: false, error: error.message };
    }

    return { success: true, path: data.path };
  } catch (error) {
    console.error('Upload failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Upload failed',
    };
  }
}

/**
 * Get a signed URL for private PDF access
 * @param filePath - Path to the file in storage
 * @param expiresIn - Seconds until URL expires (default: 1 hour)
 * @returns Signed URL or error
 */
export async function getSignedPdfUrl(
  filePath: string,
  expiresIn: number = 3600
): Promise<{
  success: boolean;
  signedUrl?: string;
  error?: string;
}> {
  if (!isSupabaseConfigured()) {
    return { success: false, error: 'Supabase is not configured' };
  }

  try {
    const { data, error } = await supabaseAdmin.storage
      .from(INVOICE_PDF_BUCKET)
      .createSignedUrl(filePath, expiresIn);

    if (error) {
      console.error('Signed URL error:', error);
      return { success: false, error: error.message };
    }

    return { success: true, signedUrl: data.signedUrl };
  } catch (error) {
    console.error('Get signed URL failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get signed URL',
    };
  }
}

/**
 * Delete a PDF from Supabase Storage
 * @param filePath - Path to the file in storage
 * @returns Success status
 */
export async function deletePdfFromStorage(
  filePath: string
): Promise<{
  success: boolean;
  error?: string;
}> {
  if (!isSupabaseConfigured()) {
    return { success: false, error: 'Supabase is not configured' };
  }

  try {
    const { error } = await supabaseAdmin.storage
      .from(INVOICE_PDF_BUCKET)
      .remove([filePath]);

    if (error) {
      console.error('Supabase delete error:', error);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (error) {
    console.error('Delete failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Delete failed',
    };
  }
}

/**
 * Get the storage path for an invoice PDF
 * @param invoiceId - Invoice ID
 * @param originalFileName - Original file name for extension
 * @returns Storage path
 */
export function getInvoicePdfPath(invoiceId: string, originalFileName?: string): string {
  const extension = originalFileName?.split('.').pop() || 'pdf';
  return `invoices/${invoiceId}/invoice.${extension}`;
}
