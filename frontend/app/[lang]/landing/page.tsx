"use client";

import { useRef, useState, type FormEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowRightIcon } from "@phosphor-icons/react/dist/csr/ArrowRight";
import { ArrowUpRightIcon } from "@phosphor-icons/react/dist/csr/ArrowUpRight";
import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { GlobeHemisphereWestIcon } from "@phosphor-icons/react/dist/csr/GlobeHemisphereWest";
import { LinkSimpleIcon } from "@phosphor-icons/react/dist/csr/LinkSimple";
import { MoonIcon } from "@phosphor-icons/react/dist/csr/Moon";
import { SunIcon } from "@phosphor-icons/react/dist/csr/Sun";
import { TranslateIcon } from "@phosphor-icons/react/dist/csr/Translate";
import { VideoCameraIcon } from "@phosphor-icons/react/dist/csr/VideoCamera";
import { WaveformIcon } from "@phosphor-icons/react/dist/csr/Waveform";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import { useTranslation } from "../components/I18nProvider";
import english from "../dictionaries/en.json";
import "./landing.css";

type CopyKey = keyof typeof english.landing;
const examples = {
  es: { name: "Español", text: "Qué alegría verte." },
  fr: { name: "Français", text: "Ça fait plaisir de te voir." },
  hi: { name: "हिन्दी", text: "तुमसे मिलकर बहुत अच्छा लगा।" },
};

export default function LandingPage() {
  const { lang } = useParams<{ lang: string }>();
  const { dictionary } = useTranslation();
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [targetLanguage, setTargetLanguage] = useState<keyof typeof examples>("es");
  const [email, setEmail] = useState("");
  const [requestStatus, setRequestStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const accessDialog = useRef<HTMLDialogElement>(null);
  const emailInput = useRef<HTMLInputElement>(null);

  const copy = (key: CopyKey) =>
    (dictionary as { landing?: Partial<Record<CopyKey, string>> }).landing?.[key] ?? english.landing[key];

  const openAccess = () => {
    accessDialog.current?.showModal();
    emailInput.current?.focus();
  };

  const requestAccess = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!email.trim() || requestStatus === "submitting") return;

    setRequestStatus("submitting");
    try {
      // Load the database SDK only when a visitor submits a request.
      const [{ addDoc, collection, serverTimestamp }, { firestore }] = await Promise.all([
        import("firebase/firestore"),
        import("@/lib/firebase"),
      ]);
      await addDoc(collection(firestore, "earlyAccessRequests"), {
        email: email.trim().toLowerCase(),
        locale: lang,
        source: "landing",
        createdAt: serverTimestamp(),
      });
      setRequestStatus("success");
      setEmail("");
    } catch {
      setRequestStatus("error");
    }
  };

  return (
    <main className="sl-landing" data-theme={theme} lang="en" dir="ltr">
      <div className="sl-shell">
        <header className="sl-header">
          <Link className="sl-brand" href={`/${lang}/landing`} aria-label="SpeakLingo home">
            <span className="sl-brand-mark"><WaveformIcon size={25} weight="bold" aria-hidden="true" /></span>
            SpeakLingo<span className="sl-brand-dot">.</span>
          </Link>
          <nav className="sl-navigation" aria-label="Main navigation">
            <a className="sl-nav-link" href="#how-it-works">{copy("howItWorks")}</a>
            <button className="sl-theme-toggle" type="button" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}>
              {theme === "dark" ? <SunIcon size={19} /> : <MoonIcon size={19} />}
            </button>
            <button className="sl-nav-cta" type="button" onClick={openAccess}>{copy("requestAccess")} <ArrowUpRightIcon size={16} aria-hidden="true" /></button>
          </nav>
        </header>

        <section className="sl-hero" aria-labelledby="sl-hero-title">
          <div className="sl-hero-copy">
            <p className="sl-eyebrow"><GlobeHemisphereWestIcon size={18} aria-hidden="true" />{copy("eyebrow")}</p>
            <h1 id="sl-hero-title">{copy("headlineOne")}<span>{copy("headlineTwo")}</span></h1>
            <p className="sl-hero-description">{copy("description")}</p>
            <div className="sl-hero-actions">
              <button className="sl-button sl-button-primary" type="button" onClick={openAccess}>{copy("requestAccess")} <ArrowUpRightIcon size={20} aria-hidden="true" /></button>
              <a className="sl-text-link" href="#how-it-works">{copy("howItWorks")} <ArrowRightIcon size={17} aria-hidden="true" /></a>
            </div>
          </div>

          <div className="sl-conversation">
            <div className="sl-portraits">
              <div className="sl-photo sl-photo-first">
                <Image
                  src="https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?auto=format&fit=crop&w=900&q=85"
                  alt="A woman smiling outdoors on a winter day"
                  fill
                  priority
                  sizes="(max-width: 767px) 52vw, (max-width: 1023px) 32vw, 310px"
                />
              </div>
              <div className="sl-photo sl-photo-second">
                <Image
                  src="https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=600&q=85"
                  alt="A relaxed portrait of a man smiling at the camera"
                  fill
                  priority
                  sizes="(max-width: 767px) 42vw, (max-width: 1023px) 28vw, 250px"
                />
              </div>
              <div className="sl-connection-mark" aria-hidden="true"><TranslateIcon size={26} /></div>
            </div>

            <div className="sl-translation-demo" aria-label="Translation example">
              <div className="sl-demo-header">
                <span><WaveformIcon size={16} aria-hidden="true" />{copy("translationExample")}</span>
                <span className="sl-demo-source">English <ArrowRightIcon size={13} aria-hidden="true" /></span>
                <label className="sl-visually-hidden" htmlFor="sl-example-language">Example translation language</label>
                <select id="sl-example-language" value={targetLanguage} onChange={(event) => setTargetLanguage(event.target.value as keyof typeof examples)}>
                  {Object.entries(examples).map(([code, example]) => <option value={code} key={code}>{example.name}</option>)}
                </select>
              </div>
              <p className="sl-source-phrase">{copy("exampleOriginal")}</p>
              <p className="sl-translated-phrase" key={targetLanguage} lang={targetLanguage} aria-live="polite">{examples[targetLanguage].text}</p>
            </div>
          </div>
        </section>

        <section className="sl-how-it-works" id="how-it-works" aria-labelledby="sl-how-title">
          <div className="sl-how-heading">
            <h2 id="sl-how-title">{copy("howHeading")}</h2>
            <p>{copy("howDescription")}</p>
          </div>
          <ol className="sl-steps">
            <li><span className="sl-step-icon"><VideoCameraIcon size={24} weight="light" aria-hidden="true" /></span><div><h3>{copy("stepOne")}</h3><p>{copy("stepOneDescription")}</p></div></li>
            <li><span className="sl-step-icon"><LinkSimpleIcon size={24} weight="light" aria-hidden="true" /></span><div><h3>{copy("stepTwo")}</h3><p>{copy("stepTwoDescription")}</p></div></li>
            <li><span className="sl-step-icon"><TranslateIcon size={24} weight="light" aria-hidden="true" /></span><div><h3>{copy("stepThree")}</h3><p>{copy("stepThreeDescription")}</p></div></li>
          </ol>
        </section>

        <footer className="sl-footer">
          <span>© {new Date().getFullYear()} SpeakLingo</span>
          <span className="sl-footer-message">{copy("footerMessage")}</span>
          <Link href={`/${lang}`}>{copy("voiceSampleLink")} <ArrowUpRightIcon size={14} aria-hidden="true" /></Link>
        </footer>
      </div>

      <dialog ref={accessDialog} className="sl-access-dialog" aria-labelledby="sl-access-title" onClick={(event) => { if (event.target === event.currentTarget) accessDialog.current?.close(); }}>
        <div className="sl-dialog-content">
          <button className="sl-dialog-close" type="button" aria-label="Close early access form" onClick={() => accessDialog.current?.close()}><XIcon size={21} /></button>
          <span className="sl-dialog-icon">{requestStatus === "success" ? <CheckIcon size={28} /> : <WaveformIcon size={28} />}</span>
          <h2 id="sl-access-title">{requestStatus === "success" ? copy("successHeading") : copy("requestAccess")}</h2>
          {requestStatus === "success" ? (
            <p className="sl-access-message" role="status">{copy("requestSuccess")}</p>
          ) : (
            <>
              <p className="sl-dialog-description" id="sl-access-help">{copy("accessDescription")}</p>
              <form className="sl-access-form" onSubmit={requestAccess} aria-busy={requestStatus === "submitting"}>
                <label htmlFor="sl-access-email">{copy("emailLabel")}</label>
                <input ref={emailInput} id="sl-access-email" name="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder={copy("emailPlaceholder")} autoComplete="email" aria-describedby="sl-access-help" required disabled={requestStatus === "submitting"} />
                <button className="sl-button sl-button-primary" type="submit" disabled={!email.trim() || requestStatus === "submitting"}>
                  {requestStatus === "submitting" ? copy("submitting") : copy("requestAccess")} <ArrowUpRightIcon size={18} aria-hidden="true" />
                </button>
                {requestStatus === "submitting" && <p className="sl-form-status" role="status">{copy("submitting")}</p>}
                {requestStatus === "error" && <p className="sl-access-error" role="alert">{copy("requestError")}</p>}
              </form>
            </>
          )}
        </div>
      </dialog>
    </main>
  );
}
