-- Migration: Add content type field to articles table
-- Date: 2026-08-13
-- Purpose: Support content type classification (论文/教程/深度/新闻/工具)

-- Add type field (TEXT, nullable)
ALTER TABLE articles ADD COLUMN type TEXT;

-- Create index for type filtering
CREATE INDEX idx_articles_type ON articles(type);
