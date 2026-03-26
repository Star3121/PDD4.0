BEGIN;

CREATE INDEX IF NOT EXISTS idx_templates_category ON public.templates(category);
CREATE INDEX IF NOT EXISTS idx_templates_pinned_usage_created
  ON public.templates(pinned DESC, usage_count DESC, created_at DESC);

COMMIT;
