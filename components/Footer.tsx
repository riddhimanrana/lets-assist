import Link from "next/link"
import Image from "next/image"
import { Mail } from "lucide-react"
import { SiInstagram, SiX } from '@icons-pack/react-simple-icons';

export function Footer() {
    return (
        <footer className="w-full border-t py-6 md:py-0 flex justify-center">
            <div className="container flex flex-col items-center justify-between gap-4 md:h-24 md:flex-row">
                <div className="flex flex-col items-center gap-4 px-8 md:flex-row md:gap-2 md:px-0">
                    <Image
                        src="/letsassist-logo.png"
                        alt="letsassist Logo"
                        width={32}
                        height={32}
                    />
                    <p className="text-center text-sm leading-loose text-muted-foreground md:text-left">
                    © 2025 Lets Assist, LLC. All rights reserved.
                        {/* Built by{" "}
                        <Link
                            href="https://rrcoder0167.is-a.dev"
                            className="font-medium underline underline-offset-4"
                        >
                            Riddhiman Rana
                        </Link> */}
                    </p>
                </div>
                <div className="flex flex-col items-center gap-4 px-8 md:flex-row md:gap-6 md:px-0">
                    <nav className="flex gap-4 md:gap-6">
                        <Link
                            href="/"
                            className="text-sm font-medium text-muted-foreground hover:text-foreground"
                        >
                            Home
                        </Link>
                        <Link
                            href="/privacy"
                            className="text-sm font-medium text-muted-foreground hover:text-foreground"
                        >
                            Privacy
                        </Link>
                        <Link
                            href="/terms"
                            className="text-sm font-medium text-muted-foreground hover:text-foreground"
                        >
                            Terms
                        </Link>
                        <Link
                            href="/contact"
                            className="text-sm font-medium text-muted-foreground hover:text-foreground"
                        >
                            Contact
                        </Link>
                        <Link
                            href="/acknowledgements"
                            className="text-sm font-medium text-muted-foreground hover:text-foreground"
                        >
                            Acknowledgements
                        </Link>
                    </nav>
                    <div className="flex items-center gap-4">
                        <Link
                            href="https://instagram.com/letsassist1"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-muted-foreground hover:text-foreground"
                        >
                            <SiInstagram className="h-4 w-4" />
                        </Link>
                        <Link
                            href="https://x.com/lets_assist"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-muted-foreground hover:text-foreground"
                        >
                            <SiX className="h-4 w-4" />
                        </Link>
                        <Link
                            href="mailto:contact@letsassist.com"
                            className="text-muted-foreground hover:text-foreground"
                        >
                            <Mail className="h-4 w-4" />
                        </Link>
                    </div>
                </div>
            </div>
        </footer>
    )
}