import { z } from "zod";

export const signupSchema = z
  .object({
    fullName: z.string().min(3, "Full name must be at least 3 characters"),
    email: z.string().email("Invalid email address"),
    password: z.string().min(8, "Password must be at least 8 characters"),
    dateOfBirth: z.string().refine(
      (date) => {
        const dob = new Date(date);
        const today = new Date();
        return dob < today && dob > new Date("1900-01-01");
      },
      "Invalid date of birth"
    ),
    parentEmail: z.string().email().optional(),
    turnstileToken: z.string().optional(),
  })
  .refine(
    (data) => {
      // If user is under 13, parent email is required
      if (isUnder13(data.dateOfBirth) && !data.parentEmail) {
        return false;
      }
      return true;
    },
    {
      message: "Parent email is required for users under 13",
      path: ["parentEmail"],
    }
  );

export type SignupFormData = z.infer<typeof signupSchema>;

/**
 * Check if a date of birth indicates the person is under 13 years old
 */
export function isUnder13(dateOfBirth: string): boolean {
  const dob = new Date(dateOfBirth);
  const today = new Date();
  
  // Calculate age
  let age = today.getFullYear() - dob.getFullYear();
  const monthDiff = today.getMonth() - dob.getMonth();
  
  // Adjust age if birthday hasn't occurred this year
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
    age--;
  }
  
  return age < 13;
}

/**
 * Calculate exact age from date of birth
 */
export function calculateAge(dateOfBirth: string): number {
  const dob = new Date(dateOfBirth);
  const today = new Date();
  
  let age = today.getFullYear() - dob.getFullYear();
  const monthDiff = today.getMonth() - dob.getMonth();
  
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
    age--;
  }
  
  return age;
}
