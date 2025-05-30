import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import Link from "next/link";
import { Metadata } from "next";
import { SiGithub } from "react-icons/si";
import { ExternalLink } from "lucide-react";
import Image from "next/image";

export const metadata: Metadata = {
  title: "Acknowledgements",
  description:
    "Acknowledgements for Let's Assist - creator and source code.",
};

export default function AcknowledgementsPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-8 text-center">
        <h1 className="text-3xl sm:text-4xl font-bold mb-4">
          Acknowledgements
        </h1>
        <p className="text-muted-foreground">
          Recognizing the people and resources that made Let&apos;s Assist possible
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="transition-all duration-300 hover:shadow-lg hover:-translate-y-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 mb-1">
              <Image
                src="/riddhimanrana.webp"
                alt="Riddhiman Rana"
                width={24}
                height={24}
              />
              Project Creator
            </CardTitle>
            <CardDescription>
              Initial Idea, Founder, and Developer
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Link
              href="https://riddhimanrana.com"
              className="text-primary font-semibold hover:text-primary/80 transition-colors duration-200 flex items-center gap-1 group"
            >
              Riddhiman Rana
              <ExternalLink size={16} className="transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </Link>
            <p className="text-sm text-muted-foreground leading-relaxed">
              You can read more about the creation of Let&apos;s Assist on my{" "}
              <Link
                href="https://riddhimanrana.com/blog/building-lets-assist"
                className="text-primary font-medium hover:text-primary/80 transition-all duration-200"
              >
                blog post
              </Link>.
            </p>
          </CardContent>
        </Card>

        <Card className="transition-all duration-300 hover:shadow-lg hover:-translate-y-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 mb-1">
              <SiGithub size={24} />
              Source Code
            </CardTitle>
            <CardDescription>
              View on GitHub
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Link
              href="https://github.com/riddhimanrana/lets-assist"
              className="text-primary font-semibold hover:text-primary/80 transition-colors duration-200 flex items-center gap-1 group"
            >
              lets-assist
              <ExternalLink size={16} className="transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </Link>
            <p className="text-sm text-muted-foreground leading-relaxed">
              This is a solo project and I&apos;m currently not accepting contributions, however the code is still openly available for transparency.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}