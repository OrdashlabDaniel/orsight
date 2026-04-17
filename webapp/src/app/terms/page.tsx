import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of Service — OrSight",
  description: "Terms governing use of the OrSight service.",
};

const EFFECTIVE_DATE = "April 17, 2026";

export default function TermsOfServicePage() {
  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <header className="border-b border-[var(--border)] bg-[var(--surface)]">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-4">
          <Link href="/login" className="text-sm font-medium text-[var(--foreground)] hover:underline">
            OrSight
          </Link>
          <Link href="/privacy" className="text-sm text-[var(--muted-foreground)] hover:underline">
            Privacy Policy
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">Terms of Service</h1>
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">
          Effective date: {EFFECTIVE_DATE}
        </p>
        <p className="mt-6 text-sm leading-relaxed">
          These Terms of Service (“Terms”) govern your access to and use of OrSight (“Service”),
          operated by Ordash Lab LLC (“Company,” “we,” “us,” “our”). By accessing or using the
          Service, you agree to these Terms. If you do not agree, do not use the Service.
        </p>

        <section className="mt-10">
          <h2 className="text-lg font-semibold">1. The Service</h2>
          <p className="mt-3 text-sm leading-relaxed">
            OrSight provides tools to process batch images and related documents, assist with form
            configuration and data extraction, and export outputs in formats we make available.
            Features may change over time. We may suspend or discontinue parts of the Service with
            reasonable notice where practicable.
          </p>
        </section>

        <section className="mt-10">
          <h2 className="text-lg font-semibold">2. Eligibility and accounts</h2>
          <p className="mt-3 text-sm leading-relaxed">
            You must be able to form a binding contract in your jurisdiction. You are responsible
            for maintaining the confidentiality of your credentials and for activity under your
            account. Notify us promptly at{" "}
            <a href="mailto:contact@ordashlab.com" className="underline">
              contact@ordashlab.com
            </a>{" "}
            if you suspect unauthorized access.
          </p>
        </section>

        <section className="mt-10">
          <h2 className="text-lg font-semibold">3. Your content</h2>
          <p className="mt-3 text-sm leading-relaxed">
            You retain rights to content you submit. You grant us a worldwide, non-exclusive license
            to host, process, transmit, display, and create derivative outputs as reasonably
            necessary to provide and improve the Service, including using subprocessors and AI
            services where applicable. You represent that you have the rights needed to submit your
            content and that doing so does not violate law or third-party rights.
          </p>
        </section>

        <section className="mt-10">
          <h2 className="text-lg font-semibold">4. Acceptable use</h2>
          <p className="mt-3 text-sm leading-relaxed">You agree not to:</p>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed">
            <li>Violate law or infringe others’ intellectual property, privacy, or publicity rights.</li>
            <li>Upload malware, attempt unauthorized access, or disrupt the Service or others’ use.</li>
            <li>Reverse engineer the Service except where applicable law prohibits this restriction.</li>
            <li>Use the Service to build a competing product by scraping or automated harvesting without permission.</li>
            <li>Submit unlawful, harassing, or highly sensitive personal data you are not permitted to process.</li>
          </ul>
        </section>

        <section className="mt-10">
          <h2 className="text-lg font-semibold">5. Third-party services</h2>
          <p className="mt-3 text-sm leading-relaxed">
            The Service may integrate sign-in providers (such as Google), hosting, databases, and AI
            providers. Your use of those integrations may be subject to third-party terms. We are not
            responsible for third-party services outside our reasonable control.
          </p>
        </section>

        <section className="mt-10">
          <h2 className="text-lg font-semibold">6. Disclaimers</h2>
          <p className="mt-3 text-sm leading-relaxed">
            The Service is provided “as is” and “as available.” To the fullest extent permitted by
            law, we disclaim all warranties, express or implied, including merchantability, fitness
            for a particular purpose, and non-infringement. AI-generated outputs may be inaccurate or
            incomplete; you are responsible for reviewing results before relying on them.
          </p>
        </section>

        <section className="mt-10">
          <h2 className="text-lg font-semibold">7. Limitation of liability</h2>
          <p className="mt-3 text-sm leading-relaxed">
            To the fullest extent permitted by law, Company and its affiliates, directors, employees,
            and agents will not be liable for any indirect, incidental, special, consequential, or
            punitive damages, or any loss of profits, data, goodwill, or business opportunities,
            arising out of or related to your use of the Service. Our aggregate liability for claims
            arising out of or related to the Service will not exceed the greater of (a) the amounts
            you paid us for the Service in the three months before the claim or (b) one hundred U.S.
            dollars (USD $100), if you have not paid fees.
          </p>
        </section>

        <section className="mt-10">
          <h2 className="text-lg font-semibold">8. Indemnity</h2>
          <p className="mt-3 text-sm leading-relaxed">
            You will defend and indemnify Company against claims, damages, liabilities, costs, and
            expenses (including reasonable attorneys’ fees) arising from your content, your use of
            the Service, or your violation of these Terms or applicable law.
          </p>
        </section>

        <section className="mt-10">
          <h2 className="text-lg font-semibold">9. Termination</h2>
          <p className="mt-3 text-sm leading-relaxed">
            You may stop using the Service at any time. We may suspend or terminate access if you
            violate these Terms, create risk or possible legal exposure, or if we discontinue the
            Service. Provisions that by their nature should survive will survive termination.
          </p>
        </section>

        <section className="mt-10">
          <h2 className="text-lg font-semibold">10. Governing law and disputes</h2>
          <p className="mt-3 text-sm leading-relaxed">
            These Terms are governed by the laws of the State of Delaware, USA, excluding conflict
            of law rules. Courts in Delaware (or another mutually agreed U.S. venue) have exclusive
            jurisdiction, except where prohibited by law for consumers in your jurisdiction.
          </p>
        </section>

        <section className="mt-10">
          <h2 className="text-lg font-semibold">11. Changes</h2>
          <p className="mt-3 text-sm leading-relaxed">
            We may modify these Terms by posting an updated version on this page. If changes are
            material, we will provide reasonable notice when practicable. Continued use after changes
            become effective constitutes acceptance.
          </p>
        </section>

        <section className="mt-10">
          <h2 className="text-lg font-semibold">12. Contact</h2>
          <p className="mt-3 text-sm leading-relaxed">
            Questions about these Terms:{" "}
            <a href="mailto:contact@ordashlab.com" className="underline">
              contact@ordashlab.com
            </a>
            .
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
