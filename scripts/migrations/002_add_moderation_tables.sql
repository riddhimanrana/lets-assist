-- Migration: Add Content Moderation Tables
-- Phase 2: Image Moderation & Content Filtering
-- Date: 2025-10-23

-- Create moderation_logs table
CREATE TABLE IF NOT EXISTS moderation_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  content_type VARCHAR(50) NOT NULL CHECK (content_type IN ('image', 'text', 'project_description', 'profile_bio', 'comment')),
  content_id VARCHAR(255), -- Reference to project_id, comment_id, etc.
  moderation_result JSONB NOT NULL, -- Full AI response
  flagged BOOLEAN DEFAULT FALSE,
  flag_reason TEXT,
  severity VARCHAR(20) CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  action_taken VARCHAR(50) CHECK (action_taken IN ('allowed', 'flagged', 'blocked', 'review_required')),
  reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_moderation_logs_user ON moderation_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_moderation_logs_flagged ON moderation_logs(flagged);
CREATE INDEX IF NOT EXISTS idx_moderation_logs_content_type ON moderation_logs(content_type);
CREATE INDEX IF NOT EXISTS idx_moderation_logs_created_at ON moderation_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_moderation_logs_severity ON moderation_logs(severity);

-- Create flagged_content table for quick lookups
CREATE TABLE IF NOT EXISTS flagged_content (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_type VARCHAR(50) NOT NULL,
  content_id VARCHAR(255) NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  flag_reason TEXT NOT NULL,
  severity VARCHAR(20) NOT NULL,
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'resolved', 'escalated')),
  moderation_log_id UUID REFERENCES moderation_logs(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(content_type, content_id)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_flagged_content_user ON flagged_content(user_id);
CREATE INDEX IF NOT EXISTS idx_flagged_content_status ON flagged_content(status);
CREATE INDEX IF NOT EXISTS idx_flagged_content_severity ON flagged_content(severity);
CREATE INDEX IF NOT EXISTS idx_flagged_content_created_at ON flagged_content(created_at DESC);

-- Add comments for documentation
COMMENT ON TABLE moderation_logs IS 'Logs all content moderation checks (images, text, etc.)';
COMMENT ON TABLE flagged_content IS 'Quick lookup table for flagged content requiring review';

COMMENT ON COLUMN moderation_logs.content_type IS 'Type of content being moderated';
COMMENT ON COLUMN moderation_logs.moderation_result IS 'Full JSON response from AI moderation service';
COMMENT ON COLUMN moderation_logs.action_taken IS 'Action taken based on moderation result';
COMMENT ON COLUMN moderation_logs.severity IS 'Severity level of flagged content';

COMMENT ON COLUMN flagged_content.status IS 'Current review status of flagged content';
COMMENT ON COLUMN flagged_content.severity IS 'Severity: low, medium, high, critical';

-- Create function to auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for flagged_content
CREATE TRIGGER update_flagged_content_updated_at
    BEFORE UPDATE ON flagged_content
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Enable RLS
ALTER TABLE moderation_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE flagged_content ENABLE ROW LEVEL SECURITY;

-- RLS Policies for moderation_logs
-- Users can view their own moderation logs
CREATE POLICY "Users can view own moderation logs"
  ON moderation_logs FOR SELECT
  USING (auth.uid() = user_id);

-- Admins can view all moderation logs (you'll need to add admin role logic)
CREATE POLICY "Service role can manage all moderation logs"
  ON moderation_logs FOR ALL
  USING (auth.role() = 'service_role');

-- RLS Policies for flagged_content
-- Users can view their own flagged content
CREATE POLICY "Users can view own flagged content"
  ON flagged_content FOR SELECT
  USING (auth.uid() = user_id);

-- Service role can manage all flagged content
CREATE POLICY "Service role can manage all flagged content"
  ON flagged_content FOR ALL
  USING (auth.role() = 'service_role');
