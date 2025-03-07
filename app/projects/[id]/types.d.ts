import { Project as BaseProject } from '@/types';

// Extend the Project type to include cover_image_url and documents
declare module '@/types' {
  interface ProjectDocument {
    name: string;
    originalName: string;
    type: string;
    size: number;
    url: string;
  }

  interface Project extends BaseProject {
    cover_image_url?: string;
    documents?: ProjectDocument[];
  }
}
