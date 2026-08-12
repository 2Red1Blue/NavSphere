-- Migration: Add featured and topic fields to articles table
-- Date: 2026-08-13
-- Purpose: Support featured articles and topic categorization

-- Add featured field (BOOLEAN, default 0)
ALTER TABLE articles ADD COLUMN featured INTEGER NOT NULL DEFAULT 0;

-- Add topic field (TEXT, nullable)
ALTER TABLE articles ADD COLUMN topic TEXT;

-- Create index for featured articles
CREATE INDEX idx_articles_featured ON articles(featured);

-- Create index for topic filtering
CREATE INDEX idx_articles_topic ON articles(topic);
