"use server";

import { createClient } from "@/utils/supabase/server";
import { revalidatePath } from "next/cache";
import { v4 as uuidv4 } from "uuid";
import { cookies } from "next/headers";

// File size and type validation constants
const MAX_COVER_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/jpg"];
const ALLOWED_DOCUMENT_TYPES = [
  "application/pdf", 
  "application/msword", 
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", 
  "text/plain",
  "image/jpeg", 
  "image/png", 
  "image/webp",
  "image/jpg"
];

// Helper function to check if date/time is in the past
const isDateTimeInPast = (date: string, time: string): boolean => {
  const [hours, minutes] = time.split(':').map(Number);
  const [year, month, day] = date.split('-').map(Number);
  
  const datetime = new Date(year, month - 1, day);
  datetime.setHours(hours, minutes, 0, 0);
  
  return datetime < new Date();
};

// Create project without files first
export async function createBasicProject(projectData: any) {
  // Validate that all dates and times are in the future
  if (projectData.eventType === "oneTime") {
    if (isDateTimeInPast(projectData.schedule.oneTime.date, projectData.schedule.oneTime.startTime) ||
        isDateTimeInPast(projectData.schedule.oneTime.date, projectData.schedule.oneTime.endTime)) {
      return { error: "Event dates and times must be in the future" };
    }
  } else if (projectData.eventType === "multiDay") {
    for (const day of projectData.schedule.multiDay) {
      for (const slot of day.slots) {
        if (isDateTimeInPast(day.date, slot.startTime) ||
            isDateTimeInPast(day.date, slot.endTime)) {
          return { error: "Event dates and times must be in the future" };
        }
      }
    }
  } else if (projectData.eventType === "sameDayMultiArea") {
    const date = projectData.schedule.sameDayMultiArea.date;
    if (isDateTimeInPast(date, projectData.schedule.sameDayMultiArea.overallStart) ||
        isDateTimeInPast(date, projectData.schedule.sameDayMultiArea.overallEnd)) {
      return { error: "Event dates and times must be in the future" };
    }
    for (const role of projectData.schedule.sameDayMultiArea.roles) {
      if (isDateTimeInPast(date, role.startTime) ||
          isDateTimeInPast(date, role.endTime)) {
        return { error: "Event dates and times must be in the future" };
      }
    }
  }
  const supabase = await createClient();

  // Get current user
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { error: "You must be logged in to create a project" };
  }

  // Get organization_id from the project data
  const organizationId = projectData.basicInfo.organizationId;

  // If organization_id is provided, verify the user has permission to create projects
  if (organizationId) {
    const { data: orgMember, error: orgError } = await supabase
      .from("organization_members")
      .select("role")
      .eq("organization_id", organizationId)
      .eq("user_id", user.id)
      .single();

    if (orgError || !orgMember) {
      return { error: "You don't have permission to create projects for this organization" };
    }

    if (orgMember.role !== "admin" && orgMember.role !== "staff") {
      return { error: "Only organization admins and staff can create projects" };
    }
  }

  try {
    // Create project in the database
    const { data: project, error: projectError } = await supabase
      .from("projects")
      .insert({
        creator_id: user.id,
        title: projectData.basicInfo.title,
        location: projectData.basicInfo.location,
        location_data: projectData.basicInfo.locationData, // Add locationData field
        description: projectData.basicInfo.description,
        event_type: projectData.eventType,
        verification_method: projectData.verificationMethod,
        require_login: projectData.requireLogin,
        schedule: {
          [projectData.eventType]: projectData.schedule[projectData.eventType],
        },
        status: "active",
        organization_id: organizationId || null, // Save organization_id if provided
        is_private: organizationId ? projectData.isPrivate : false, // Set is_private based on organization and preference
      })
      .select("id")
      .single();

    if (projectError) {
      console.error("Error creating project:", projectError);
      return { error: "Failed to create project. Please try again." };
    }

    // Return success with the new project ID
    return { success: true, id: project.id };
  } catch (error) {
    console.error("Error in create project action:", error);
    return { error: "An unexpected error occurred. Please try again." };
  }
}

// Handle cover image upload separately - made more similar to profile picture upload
export async function uploadCoverImage(projectId: string, imageBase64: string) {
  const supabase = await createClient();
  
  try {
    // Skip if no image data - cover images are optional
    if (!imageBase64 || !imageBase64.includes('base64')) {
      return { success: true };
    }
    
    // Process base64 image
    const base64Str = imageBase64.split(",")[1];
    const buffer = Buffer.from(base64Str, "base64");
    const contentType = imageBase64.split(";")[0].split(":")[1];
    
    // Validate content type
    if (!ALLOWED_IMAGE_TYPES.includes(contentType)) {
      return { error: "Invalid cover image type. Please use JPEG, JPG, PNG or WebP." };
    }
    
    // Validate size (approximate from base64)
    const sizeInBytes = Math.ceil(base64Str.length * 0.75);
    if (sizeInBytes > MAX_COVER_IMAGE_SIZE) {
      return { error: "Cover image is too large. Maximum size is 5MB." };
    }
    
    // Create unique filename - now directly in the bucket root
    const timestamp = Date.now();
    const fileName = `project_${projectId}_cover_${timestamp}.${contentType.split('/')[1]}`;
    
    // Upload to Supabase Storage - no subfolder
    const { error: uploadError } = await supabase.storage
      .from('project-images')
      .upload(fileName, buffer, {
        contentType: contentType,
        cacheControl: '3600',
        upsert: false
      });
      
    if (uploadError) {
      console.error("Error uploading cover image:", uploadError);
      return { error: "Failed to upload cover image." };
    }
    
    // Get public URL
    const { data: publicUrlData } = supabase.storage
      .from('project-images')
      .getPublicUrl(fileName);
      
    // Update project with cover image URL
    const { error: updateError } = await supabase
      .from("projects")
      .update({
        cover_image_url: publicUrlData.publicUrl
      })
      .eq("id", projectId);
      
    if (updateError) {
      console.error("Error linking cover image to project:", updateError);
      return { error: "Failed to link cover image to project." };
    }
      
    return { success: true, url: publicUrlData.publicUrl };
  } catch (error) {
    console.error("Error uploading cover image:", error);
    return { error: "An unexpected error occurred during image upload." };
  }
}

// Improved document upload function with stricter size validation
export async function uploadProjectDocument(projectId: string, documentBase64: string, fileName: string, fileType: string) {
  const supabase = await createClient();
  
  try {
    // Skip if no document data
    if (!documentBase64 || !documentBase64.includes('base64')) {
      return { success: true };
    }
    
    // Process base64 document - check size first
    const base64Str = documentBase64.split(",")[1];
    const sizeInBytes = Math.ceil(base64Str.length * 0.75);
    
    // More strict size validation (10MB max per document)
    if (sizeInBytes > 10 * 1024 * 1024) {
      return { error: "Document is too large. Maximum size is 10MB." };
    }
    
    const buffer = Buffer.from(base64Str, "base64");
    const contentType = fileType || documentBase64.split(";")[0].split(":")[1];
    
    // Validate content type
    if (!ALLOWED_DOCUMENT_TYPES.includes(contentType)) {
      return { error: "Invalid document type." };
    }
    
    // Create unique filename with a smaller random ID
    const timestamp = Date.now();
    const documentId = uuidv4().substring(0, 8);
    const fileExt = fileName.split('.').pop() || contentType.split('/')[1] || 'file';
    const safeFileName = `project_${projectId}_${documentId}_${timestamp}.${fileExt}`;
    
    // Upload to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from('project-documents')
      .upload(safeFileName, buffer, {
        contentType: contentType,
        cacheControl: '3600',
        upsert: false
      });
      
    if (uploadError) {
      console.error(`Error uploading document ${fileName}:`, uploadError);
      return { error: "Failed to upload document." };
    }
    
    // Get public URL
    const { data: publicUrlData } = supabase.storage
      .from('project-documents')
      .getPublicUrl(safeFileName);
      
    // Get current documents and append new one
    const { data: projectData } = await supabase
      .from("projects")
      .select("documents")
      .eq("id", projectId)
      .single();
      
    const currentDocs = projectData?.documents || [];
    
    // Add new document
    const newDoc = {
      name: fileName,
      originalName: fileName,
      type: contentType,
      size: sizeInBytes,
      url: publicUrlData.publicUrl
    };
    
    // Update project with document URLs
    const { error: updateError } = await supabase
      .from("projects")
      .update({
        documents: [...currentDocs, newDoc]
      })
      .eq("id", projectId);
      
    if (updateError) {
      console.error("Error linking document to project:", updateError);
      return { error: "Failed to link document to project." };
    }
      
    return { success: true, document: newDoc };
  } catch (error) {
    console.error("Error uploading document:", error);
    return { error: "An unexpected error occurred during document upload." };
  }
}

// Save project and revalidate paths
export async function finalizeProject(projectId: string) {
  try {
    // Revalidate the projects list page
    revalidatePath("/projects");
    return { success: true, id: projectId };
  } catch (error) {
    console.error("Error in finalize project action:", error);
    return { error: "An unexpected error occurred. Please try again." };
  }
}

// Wrapper function that creates the project only - no file handling
export async function createProject(formData: FormData) {
  try {
    // Parse project data
    const projectDataStr = formData.get("projectData") as string;
    if (!projectDataStr) return { error: "Missing project data" };
    const projectData = JSON.parse(projectDataStr);
    
    // Create basic project record
    const basicResult = await createBasicProject(projectData);
    if (basicResult.error) return basicResult;
    
    // Return the project ID - client will handle file uploads separately
    return { success: true, id: basicResult.id };
  } catch (error) {
    console.error("Error in create project wrapper:", error);
    return { error: "An unexpected error occurred. Please try again." };
  }
}
