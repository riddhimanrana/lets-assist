import { NextRequest, NextResponse } from 'next/server';
import { generateObject } from 'ai';
import { z } from 'zod';
import { getAuthUser } from '@/lib/supabase/auth-helpers';

// Schema for precise bounding box coordinates (in PDF points)
const BoundingBoxSchema = z.object({
  x: z.number().describe('X coordinate from left edge of page (in PDF points, 72 points = 1 inch)'),
  y: z.number().describe('Y coordinate from BOTTOM edge of page (in PDF points, standard PDF coordinate system)'),
  width: z.number().describe('Width of the field (in PDF points)'),
  height: z.number().describe('Height of the field (in PDF points)')
});

// Schema for detected fields with precise positioning
const WaiverFieldSchema = z.object({
  fieldType: z.enum(['name', 'signature', 'initial', 'date', 'email', 'phone', 'address', 'text', 'checkbox']),
  label: z.string().describe('Human-readable label for this field (e.g., "Volunteer Name", "Parent Signature", "Emergency Contact Phone")'),
  signerRole: z.string().describe('Who should fill this field (e.g., "volunteer", "parent", "guardian")'),
  pageIndex: z.number().describe('Page number (0-indexed, so first page is 0)'),
  boundingBox: BoundingBoxSchema.describe('Precise coordinates of the field on the page'),
  required: z.boolean().describe('Whether this field is required based on the waiver text'),
  notes: z.string().optional().describe('Any special instructions or context for this field')
});

const WaiverAnalysisSchema = z.object({
  pageCount: z.number().describe('Total number of pages in the PDF'),
  
  pageDimensions: z.array(z.object({
    pageIndex: z.number().describe('Page number (0-indexed)'),
    width: z.number().describe('Page width in PDF points'),
    height: z.number().describe('Page height in PDF points')
  })).describe('Dimensions of each page in the PDF'),
  
  signerRoles: z.array(z.object({
    roleKey: z.string().describe('Machine-readable key (e.g., "volunteer", "parent", "guardian")'),
    label: z.string().describe('Human-readable label (e.g., "Volunteer", "Parent/Guardian")'),
    required: z.boolean().describe('Whether this role must sign based on the waiver text'),
    description: z.string().optional().describe('Context about when this signer is needed')
  })).describe('All signer roles mentioned in the waiver'),
  
  fields: z.array(WaiverFieldSchema).describe('All fields that need to be filled in or signed, with precise bounding boxes'),
  
  summary: z.string().describe('Brief summary of what the waiver covers'),
  
  recommendations: z.array(z.string()).describe('Suggestions for setting up the waiver fields')
});

export async function POST(request: NextRequest) {
  try {
    const { user } = await getAuthUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    if (file.type !== 'application/pdf') {
      return NextResponse.json({ error: 'File must be a PDF' }, { status: 400 });
    }

    // Convert PDF to base64 data URL for Gemini
    const arrayBuffer = await file.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');
    const dataUrl = `data:application/pdf;base64,${base64}`;

    // Use Gemini to analyze the PDF with vision capabilities
    const result = await generateObject({
      model: 'google/gemini-2.5-flash-lite',
      schema: WaiverAnalysisSchema,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `You are analyzing a waiver/consent form PDF. Your task is to identify ALL signature areas, name fields, date fields, and other form fields.

CRITICAL COORDINATE INSTRUCTIONS:
- Standard letter-size PDF is 612 points wide × 792 points tall (8.5" × 11" at 72 dpi)
- X coordinate: Distance from LEFT edge (0 = left edge, 612 = right edge)
- Y coordinate: Distance from BOTTOM edge (0 = bottom, 792 = top)
- All measurements in PDF points (72 points = 1 inch)

EXAMPLE: A signature line in the middle-bottom area of page 1 might be:
{
  "pageIndex": 0,
  "boundingBox": { "x": 150, "y": 200, "width": 300, "height": 40 }
}

Your job:
1. Report page count and dimensions (typically 612×792 for letter size)
2. Identify signer roles from document text (volunteer, parent, guardian, etc.)
3. Find ALL input fields with their VISUAL locations:
   - Signature lines/boxes (look for "Signature:", "Sign here:", "X____")
   - Name fields ("Name:", "Print name:", blank lines after "Name of")
   - Date fields ("Date:", "__/__/__", date indicators)
   - Email/phone fields (labeled accordingly)
   - Checkbox fields
   - Initial boxes ("Initial:", small boxes)

4. For each field provide:
   - fieldType: signature, name, date, email, phone, initial, text, checkbox
   - label: Clear description (e.g., "Volunteer Signature", "Parent Name")
   - signerRole: Who fills it (volunteer, parent, guardian)
   - pageIndex: 0 for first page, 1 for second, etc.
   - boundingBox: Visual location in PDF points
   - required: true if the field appears mandatory

Be THOROUGH - scan the entire document systematically from top to bottom of each page.`
            },
            {
              type: 'image',
              image: dataUrl
            }
          ]
        }
      ],
      temperature: 0.1, // Very low temperature for consistency
    });

    return NextResponse.json({
      success: true,
      analysis: result.object
    });

  } catch (error) {
    console.error('AI waiver analysis error:', error);
    return NextResponse.json(
      { 
        error: 'Failed to analyze waiver', 
        details: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    );
  }
}
