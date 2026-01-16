import { Img, Row, Column, Section } from "@react-email/components";
import * as React from "react";

interface EmailHeaderProps {
  /** Absolute URL recommended for best deliverability (e.g., https://lets-assist.com/logo.png). */
  logoUrl?: string;
  alt?: string;
}

export default function EmailHeader({
  logoUrl = "https://lets-assist.com/logo.png",
  alt = "Let's Assist",
}: EmailHeaderProps) {
  return (
    <Section style={header}>
      <Row>
        <Column style={logoContainer}>
          <Img src={logoUrl} alt={alt} style={logo} width={49} height="auto" />
        </Column>
        <Column style={{ width: "65%" }} />
      </Row>
    </Section>
  );
}

const header = {
  padding: "24px 24px 20px",
};

const logoContainer = {
  width: "35%",
  paddingRight: "12px",
};

const logo = {
  display: "block",
  height: "auto",
  maxWidth: "100%",
};
