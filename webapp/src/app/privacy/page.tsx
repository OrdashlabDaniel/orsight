import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy — OrSight",
  description: "How OrSight collects, uses, and protects your information.",
};

const EFFECTIVE_DATE = "April 17, 2026";

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <header className="border-b border-[var(--border)] bg-[var(--surface)]">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-4">
          <Link href="/login" className="text-sm font-medium text-[var(--foreground)] hover:underline">
            OrSight
          </Link>
          <Link href="/terms" className="text-sm text-[var(--muted-foreground)] hover:underline">
            Terms of Service
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">Privacy Policy</h1>
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">
          Effective date: {EFFECTIVE_DATE}
        </p>
        <p className="mt-6 text-sm leading-relaxed">
          Ordash Lab LLC (“we,” “us,” “our”) operates OrSight (“Service”). This Privacy Policy
          describes how we collect, use, disclose, and safeguard information when you use the
          Service. By using the Service, you agree to this policy. If you do not agree, please do
          not use the Service.
        </p>

        <section className="mt-10">
          <h2 className="text-lg font-semibold">1. Who we are</h2>
          <p className="mt-3 text-sm leading-relaxed">
            The Service is provided by Ordash Lab LLC. For privacy-related requests, contact us at{" "}
            <a href="mailto:contact@ordashlab.com" className="underline">
              contact@ordashlab.com
            </a>
            .
          </p>
        </section>

        <section className="mt-10">
          <h2 className="text-lg font-semibold">2. Information we collect</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed">
            <li>
              <strong>Account information.</strong> When you sign in (for example with Google), we
              may receive identifiers and profile information such as your email address and name,
              as permitted by the sign-in provider and your settings.
            </li>
            <li>
              <strong>Content you submit.</strong> Images, documents, form definitions, training
              examples, and other materials you upload or generate through the Service.
            </li>
            <li>
              <strong>Technical data.</strong> IP address, device/browser type, general location
              derived from IP, timestamps, and diagnostic logs needed to operate and secure the
              Service.
            </li>
            <li>
              <strong>Cookies and similar technologies.</strong> We use cookies and local storage as
              needed for authentication, preferences, and security.
            </li>
          </ul>
        </section>

        <section className="mt-10">
          <h2 className="text-lg font-semibold">3. How we use information</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed">
            <li>Provide, maintain, improve, and secure the Service.</li>
            <li>Authenticate users and prevent fraud or abuse.</li>
            <li>Process your content to deliver features you request (including AI-assisted workflows).</li>
            <li>Communicate about the Service, support requests, and important notices.</li>
            <li>Comply with law and enforce our Terms of Service.</li>
          </ul>
        </section>

        <section className="mt-10">
          <h2 className="text-lg font-semibold">4. AI and automated processing</h2>
          <p className="mt-3 text-sm leading-relaxed">
            Parts of the Service may send portions of your content to third-party AI providers to
            generate outputs you request. We configure processing to support the Service; providers
            may process data according to their own terms and policies. Do not submit highly
            sensitive personal data unless you accept that risk.
          </p>
        </section>

        <section className="mt-10">
          <h2 className="text-lg font-semibold">5. How we share information</h2>
          <p className="mt-3 text-sm leading-relaxed">
            We do not sell your personal information. We may share information with:
          </p>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed">
            <li>
              <strong>Service providers</strong> that host or operate the Service (for example cloud
              hosting, authentication, databases, analytics, and AI inference), under contractual
              obligations to protect data and use it only for our instructions.
            </li>
            <li>
              <strong>Legal and safety</strong> when required by law, legal process, or to protect
              rights, safety, and security.
            </li>
            <li>
              <strong>Business transfers</strong> in connection with a merger, acquisition, or sale
              of assets, subject to appropriate safeguards.
            </li>
          </ul>
        </section>

        <section className="mt-10">
          <h2 className="text-lg font-semibold">6. Retention</h2>
          <p className="mt-3 text-sm leading-relaxed">
            We retain information for as long as needed to provide the Service, comply with legal
            obligations, resolve disputes, and enforce agreements. Retention periods may vary by
            data type and configuration of your workspace.
          </p>
        </section>

        <section className="mt-10">
          <h2 className="text-lg font-semibold">7. Security</h2>
          <p className="mt-3 text-sm leading-relaxed">
            We use reasonable administrative, technical, and organizational measures designed to
            protect information. No method of transmission or storage is completely secure.
          </p>
        </section>

        <section className="mt-10">
          <h2 className="text-lg font-semibold">8. Your choices and rights</h2>
          <p className="mt-3 text-sm leading-relaxed">
            Depending on where you live, you may have rights to access, correct, delete, or
            restrict certain processing of your personal information, and to object or port data.
            To exercise rights, contact{" "}
            <a href="mailto:contact@ordashlab.com" className="underline">
              contact@ordashlab.com
            </a>
            . We may need to verify your request.
          </p>
        </section>

        <section className="mt-10">
          <h2 className="text-lg font-semibold">9. International transfers</h2>
          <p className="mt-3 text-sm leading-relaxed">
            We may process and store information in the United States and other countries where we
            or our providers operate. Those countries may have different data protection laws than
            your country.
          </p>
        </section>

        <section className="mt-10">
          <h2 className="text-lg font-semibold">10. Children</h2>
          <p className="mt-3 text-sm leading-relaxed">
            The Service is not directed to children under 13 (or the minimum age required in your
            jurisdiction). We do not knowingly collect personal information from children.
          </p>
        </section>

        <section className="mt-10">
          <h2 className="text-lg font-semibold">11. Changes to this policy</h2>
          <p className="mt-3 text-sm leading-relaxed">
            We may update this Privacy Policy from time to time. We will post the updated version on
            this page and update the effective date. Material changes may be communicated through the
            Service or by email where appropriate.
          </p>
        </section>

        <p className="mt-12 border-t border-[var(--border)] pt-8 text-xs leading-relaxed text-[var(--muted-foreground)]">
          This document is provided to support product configuration (including OAuth consent
          screens) and general transparency. It is not tailored legal advice for your jurisdiction;
          consult qualified counsel for compliance obligations that apply to your business.
        </p>
      </main>
    </div>
  );
}
