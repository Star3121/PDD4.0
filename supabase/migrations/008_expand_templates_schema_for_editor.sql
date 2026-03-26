BEGIN;

ALTER TABLE public.templates
  ADD COLUMN IF NOT EXISTS canvas_data TEXT,
  ADD COLUMN IF NOT EXISTS width INTEGER,
  ADD COLUMN IF NOT EXISTS height INTEGER,
  ADD COLUMN IF NOT EXISTS background_color TEXT DEFAULT '#FFFFFF',
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS template_code TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS usage_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pinned BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

UPDATE public.templates
SET source = 'user_design'
WHERE COALESCE(source, '') = '' AND COALESCE(canvas_data, '') <> '';

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_templates_updated_at') THEN
    CREATE TRIGGER update_templates_updated_at BEFORE UPDATE ON public.templates
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END $$;

COMMIT;
