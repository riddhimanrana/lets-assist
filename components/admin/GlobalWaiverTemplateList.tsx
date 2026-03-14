'use client';

import { WaiverDefinition } from '@/types/waiver-definitions';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { activateGlobalTemplate, deleteGlobalTemplate } from '@/app/admin/waivers/actions';
import { toast } from 'sonner';
import { useState } from 'react';
import { FileText, Calendar, Users, Eye, Edit, Trash2, CheckCircle2 } from 'lucide-react';

interface Props {
  templates: WaiverDefinition[];
}

export function GlobalWaiverTemplateList({ templates }: Props) {
  const activeTemplate = templates.find(t => t.active);
  const inactiveTemplates = templates.filter(t => !t.active);
  
  return (
    <div className="space-y-8">
      {/* Active Template Section */}
      {activeTemplate && (
        <section>
          <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-green-600" />
            Active Template
          </h2>
          <TemplateCard template={activeTemplate} isActive={true} />
        </section>
      )}
      
      {/* All Templates Section */}
      <section>
        <h2 className="text-xl font-semibold mb-4">All Templates</h2>
        <div className="space-y-4">
          {templates.length === 0 ? (
            <div className="text-center py-12 bg-muted/30 rounded-lg border border-dashed">
              <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
              <h3 className="text-lg font-medium">No templates found</h3>
              <p className="text-muted-foreground mt-1">Create your first global waiver template to get started.</p>
            </div>
          ) : (
            inactiveTemplates.map(template => (
              <TemplateCard key={template.id} template={template} />
            ))
          )}
          {/* Also show active template in the list if needed, or just keep separate. 
              The requirement said "All Templates Table/List", implying the active one should also be there 
              or at least visible. The mock showed "Active" badge. 
              If I filter out active above, I should probably include it here too but with active status.
          */}
          {activeTemplate && (
             <TemplateCard key={activeTemplate.id} template={activeTemplate} isDuplicate={true} />
          )}
        </div>
      </section>
    </div>
  );
}

function TemplateCard({ template, isActive, isDuplicate }: { template: WaiverDefinition; isActive?: boolean; isDuplicate?: boolean }) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [isActivating, setIsActivating] = useState(false);

  const handleActivate = async () => {
    setIsActivating(true);
    try {
      const result = await activateGlobalTemplate(template.id);
      if (result.success) {
        toast.success("Template activated successfully");
        window.location.reload();
      } else {
        toast.error(result.error || "Failed to activate template");
      }
    } catch (error) {
      toast.error("An unexpected error occurred");
    } finally {
      setIsActivating(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this template? This action cannot be undone.')) return;
    
    setIsDeleting(true);
    try {
      const result = await deleteGlobalTemplate(template.id);
      if (result.success) {
        toast.success("Template deleted successfully");
        window.location.reload();
      } else {
        toast.error(result.error || "Failed to delete template");
      }
    } catch (error) {
      toast.error("An unexpected error occurred");
    } finally {
      setIsDeleting(false);
    }
  };

  const openPreview = () => {
      if (template.pdf_public_url) {
          window.open(template.pdf_public_url, '_blank');
      } else {
          toast.error("PDF URL not available");
      }
  };

  // Skip showing duplicate in "All Templates" if it's visually confusing, 
  // but listing requirements said "All Templates Table/List".
  // If `isActive` is true, we render it specifically as the active card.
  // If `isDuplicate` is true, we check if we want to show it again in the list.
  // Let's hide duplicates for cleaner UI if it's already shown at top.
  if (isDuplicate) return null;

  return (
    <Card className={`p-6 ${isActive ? 'border-green-500/50 bg-green-50/10' : ''}`}>
      <div className="flex flex-col md:flex-row justify-between items-start gap-4">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h3 className="text-lg font-semibold">{template.title}</h3>
            {template.active ? (
              <Badge variant="default" className="bg-green-600 hover:bg-green-700">Active</Badge>
            ) : (
                <Badge variant="secondary">Inactive</Badge>
            )}
            <Badge variant="outline">v{template.version}</Badge>
          </div>
          <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
             <span className="flex items-center gap-1">
                 <Calendar className="h-3.5 w-3.5" />
                 {new Date(template.created_at).toLocaleDateString()}
             </span>
             {/* We need to cast or ensure types for signers/fields if they are joined */}
             {/* @ts-ignore */}
             {template.signers && (
                <span className="flex items-center gap-1">
                    <Users className="h-3.5 w-3.5" />
                    {/* @ts-ignore */}
                    {template.signers.length} signers
                </span>
             )}
          </div>
        </div>
        
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={openPreview}>
              <Eye className="h-4 w-4 mr-2" />
              Preview
          </Button>
          {/* Edit button - for metadata editing often */}
          {/* <Button variant="outline" size="sm">
              <Edit className="h-4 w-4 mr-2" />
              Edit
          </Button> */}
          
          {!template.active && (
            <Button 
              size="sm"
              variant="default"
              onClick={handleActivate}
              disabled={isActivating}
            >
              {isActivating ? 'Activating...' : 'Activate'}
            </Button>
          )}
          
          <Button 
            variant="destructive" 
            size="sm"
            onClick={handleDelete}
            disabled={isDeleting || template.active} // Prevent deleting active template
          >
            <Trash2 className="h-4 w-4 mr-2" />
            {isDeleting ? 'Deleting...' : 'Delete'}
          </Button>
        </div>
      </div>
    </Card>
  );
}
