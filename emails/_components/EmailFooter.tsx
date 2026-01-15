import { Section, Text, Link, Row, Column } from "@react-email/components";
import * as React from "react";

export default function EmailFooter() {
  const currentYear = new Date().getFullYear();

  return (
    <Section style={footerBox}>
      <Row>
        <Column>
          <Text style={footerText}>
            Questions? Contact{" "}
            <Link href="mailto:support@lets-assist.com" style={footerLink}>
              support@lets-assist.com
            </Link>
            
          </Text>
          <Text style={footerText}>
            <Link href="https://lets-assist.com/privacy" style={footerLink}>
              Privacy Policy
            </Link>
            {" • "}
            <Link href="https://lets-assist.com/terms" style={footerLink}>
              Terms of Service
            </Link>
          </Text>
          <Text style={footerText}>
            © {currentYear} Riddhiman Rana. All rights reserved.
          </Text>
        </Column>
      </Row>
    </Section>
  );
}

const footerBox = {
  padding: "32px 24px",
  backgroundColor: "#f9fafb",
  borderTop: "1px solid #eef2f7",
};

const footerText = {
  color: "#6b7280",
  fontSize: "12px",
  lineHeight: "1.6",
  margin: "4px 0",
  textAlign: "center" as const,
};

const footerLink = {
  color: "#16a34a",
  textDecoration: "none",
  fontWeight: "600" as const,
};
