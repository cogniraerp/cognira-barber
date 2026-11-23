/** Puerto de almacenamiento de archivos. Local hoy; Supabase Storage / S3 mañana. */
export abstract class StorageProvider {
  abstract put(key: string, data: Buffer, contentType: string): Promise<void>;
  abstract delete(key: string): Promise<void>;
  abstract publicUrl(key: string): string;
  /** Convierte una URL pública propia de vuelta a su key (null si no es nuestra). */
  abstract keyFromUrl(url: string): string | null;
}
