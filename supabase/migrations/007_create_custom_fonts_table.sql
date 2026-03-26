BEGIN;

CREATE TABLE IF NOT EXISTS public.custom_fonts (
  id BIGSERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  font_family TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  family TEXT DEFAULT '',
  subfamily TEXT DEFAULT '',
  postscript_name TEXT DEFAULT '',
  original_filename TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_url TEXT NOT NULL,
  storage_url TEXT DEFAULT '',
  url TEXT DEFAULT '',
  path TEXT DEFAULT '',
  format TEXT NOT NULL DEFAULT 'woff2',
  size_bytes BIGINT DEFAULT 0,
  hash TEXT DEFAULT '',
  uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_custom_fonts_uploaded_at ON public.custom_fonts (uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_custom_fonts_updated_at ON public.custom_fonts (updated_at DESC);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_custom_fonts_updated_at') THEN
    CREATE TRIGGER update_custom_fonts_updated_at BEFORE UPDATE ON public.custom_fonts
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END $$;

COMMIT;
