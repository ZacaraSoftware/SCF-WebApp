-- ============================================================================
-- BI Cube Dimensionen: Region, Produkt, Quarter
-- Ermöglicht explorative Analysen über Raum und Zeit hinweg
-- ============================================================================

-- Neue Spalten für BI Cube Dimensionen
ALTER TABLE public.mentions ADD COLUMN IF NOT EXISTS region text;
ALTER TABLE public.mentions ADD COLUMN IF NOT EXISTS product text;
ALTER TABLE public.mentions ADD COLUMN IF NOT EXISTS quarter text;

-- Indices für Performance
CREATE INDEX IF NOT EXISTS mentions_region_idx ON public.mentions (region);
CREATE INDEX IF NOT EXISTS mentions_product_idx ON public.mentions (product);
CREATE INDEX IF NOT EXISTS mentions_quarter_idx ON public.mentions (quarter);

-- Composite Index für häufige Filter-Kombinationen
CREATE INDEX IF NOT EXISTS mentions_quarter_region_product_idx
  ON public.mentions (quarter, region, product) WHERE quarter IS NOT NULL;