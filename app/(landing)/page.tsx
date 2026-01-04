import { Metadata } from "next";
import HomeClient from "./HomeClient";

export const metadata: Metadata = {
  title: "Let's Assist: Connect Volunteers with Opportunities",
  description: "A platform connecting volunteers with opportunities to make a difference in their communities.",
};

export default function HomePage() {
  return <HomeClient />;
}
