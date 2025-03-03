import { Metadata } from "next";
import ContactClient from "./ContactClient";

export const metadata: Metadata = {
  title: "Contact Us",
  description: "Get in touch with the Let's Assist team for support, feature requests, or bug reports.",
};

export default function ContactPage() {
  return <ContactClient />;
}
