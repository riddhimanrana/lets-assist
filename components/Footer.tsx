import Link from "next/link";
import Image from "next/image";
import { Mail } from "lucide-react";
import { SiInstagram, SiX } from "react-icons/si";

export function Footer() {
  return (
    <footer className="w-full border-t py-8 md:py-6">
      <div className="container px-4 mx-auto">
        {/* Mobile layout (stacked) */}
        <div className="flex flex-col space-y-8 sm:space-y-6 md:hidden">
          {/* Left aligned logo */}
          <div className="flex justify-start ml-3">
            <Image
              src="/logo.png"
              alt="letsassist Logo"
              width={40}
              height={40}
              className="h-8 w-auto"
            />
          </div>

          {/* Left aligned nav links */}
          <nav className="mt-2 grid grid-cols-2 gap-x-6 gap-y-4 text-left sm:flex sm:flex-wrap sm:justify-start sm:gap-x-8 ml-3">
            <Link
              href="/"
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Home
            </Link>
            <Link
              href="/privacy"
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Privacy
            </Link>
            <Link
              href="/terms"
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Terms
            </Link>
            <Link
             href="/help"
              className="text-sm text-muted-foreground hover:text-foreground sm:col-span-2 sm:w-full"
            >
              Help
            </Link>
            <Link
              href="/contact"
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Contact
            </Link>
            <Link
              href="/acknowledgements"
              className="text-sm text-muted-foreground hover:text-foreground sm:col-span-2 sm:w-full"
            >
              Acknowledgements
            </Link>
            
          </nav>

          {/* Copyright with social media icons right aligned */}
          <div className="flex items-center justify-between ml-3">
            <p className="text-sm text-muted-foreground">
              © 2025 Riddhiman Rana
            </p>
            <div className="flex items-center mr-5 space-x-4">
              <Link
                href="https://instagram.com/letsassist.app"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Instagram"
              >
                <SiInstagram className="h-5 w-5" />
              </Link>
              <Link
                href="https://x.com/letsassistapp"
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground hover:text-foreground"
                aria-label="Twitter"
              >
                <SiX className="h-5 w-5" />
              </Link>
              <Link
                href="mailto:contact@lets-assist.com"
                className="text-muted-foreground hover:text-foreground"
                aria-label="Email"
              >
                <Mail className="h-5 w-5" />
              </Link>
            </div>
          </div>
        </div>

        {/* Desktop layout (horizontal) */}
        <div className="hidden md:flex md:flex-row md:items-center md:justify-between">
          <div className="flex items-center space-x-3">
            {/* Already left aligned */}
            <Image
              src="/logo.png"
              alt="letsassist Logo"
              width={32}
              height={32}
            />
            <p className="text-sm text-muted-foreground">
              © 2025 Riddhiman Rana. All rights reserved.
            </p>
          </div>

          <div className="flex items-center space-x-8">
            <nav className="flex space-x-6 text-left">
              <Link
                href="/"
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                Home
              </Link>
              <Link
                href="/privacy"
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                Privacy
              </Link>
              <Link
                href="/terms"
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                Terms
              </Link>
              <Link
             href="/help"
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Help
            </Link>
              <Link
                href="/contact"
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                Contact
              </Link>
              <Link
                href="/acknowledgements"
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                Acknowledgements
              </Link>
            </nav>

            <div className="flex items-center space-x-4">
              <Link
                href="https://instagram.com/letsassist.app"
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground hover:text-foreground"
                aria-label="Instagram"
              >
                <SiInstagram className="h-4 w-4" />
              </Link>
              <Link
                href="https://x.com/letsassistapp"
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground hover:text-foreground"
                aria-label="X / Twitter"
              >
                <SiX className="h-4 w-4" />
              </Link>
              <Link
                href="mailto:contact@lets-assist.com"
                className="text-muted-foreground hover:text-foreground"
                aria-label="Email"
              >
                <Mail className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
