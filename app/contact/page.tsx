import { Metadata } from "next";
import ContactClient from "./ContactClient";

export const metadata: Metadata = {
  title: "Contact Us",
  description:
    "Get in touch with the Let's Assist team for support, feature requests, bug reports, or organization setup.",
};

export default function ContactPage() {
  return <ContactClient />;
}
