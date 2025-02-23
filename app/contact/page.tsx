import Link from "next/link"
import { Mail } from "lucide-react"
import { SiX, SiInstagram } from '@icons-pack/react-simple-icons';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export default function ContactPage() {
    return (
        <div className="max-w-6xl mx-auto py-8">
            <div className="mb-8 text-center">
                <h1 className="text-3xl font-bold mb-2">Contact Us</h1>
                <p className="text-muted-foreground">Get in touch with our team</p>
            </div>
            
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Mail className="h-5 w-5" />
                            Email
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <Link href="mailto:contact@letsassist.com" className="text-muted-foreground hover:text-foreground">
                            team@lets-assist.com
                        </Link>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <SiInstagram className="h-5 w-5" />
                            Instagram
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <Link href="https://instagram.com/letsassist1" target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground">
                            @letsassist1
                        </Link>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <SiX className="h-5 w-5" />
                            X/Twitter
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <Link href="https://x.com/lets_assist" target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground">
                            @lets_assist
                        </Link>
                    </CardContent>
                </Card>

                <Card className="md:col-span-2">
                    <CardHeader>
                        <CardTitle>
                            Are you an organization/school?
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className="text-muted-foreground">
                            Feel free to send us an email to <Link href="mailto:team@lets-assist.com" className="text-foreground hover:underline">team@lets-assist.com</Link> and we can discuss how we can integrate this into your organization/school.
                        </p>
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}
