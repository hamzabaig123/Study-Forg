import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";
import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  BarChart3,
  BookOpen,
  CheckCircle2,
  Clock,
  Download,
  Layers,
  ListChecks,
  QrCode,
  Share2,
  Sparkles,
  Timer,
} from "lucide-react";

const HIERARCHY = [
  { label: "Class", detail: "Group a whole course or grade level" },
  { label: "Subject", detail: "Split a class into its disciplines" },
  { label: "Chapter", detail: "Break a subject into teaching units" },
  { label: "Topic", detail: "The smallest unit you author questions for" },
];

const QUESTION_TYPES = [
  {
    icon: ListChecks,
    name: "Multiple choice",
    detail:
      "Author a prompt with any number of options and mark the correct one.",
  },
  {
    icon: CheckCircle2,
    name: "True / false",
    detail: "Fast to write, fast to grade — ideal for recall checks.",
  },
  {
    icon: BookOpen,
    name: "Short answer",
    detail:
      "Students type a response and it is matched against the expected answer.",
  },
];

const FEATURES = [
  {
    icon: Sparkles,
    title: "AI question generation",
    detail:
      "Paste source text or describe what you want to test. StudyForge drafts questions you review and accept into the topic.",
  },
  {
    icon: Timer,
    title: "Practice & timed tests",
    detail:
      "Run an untimed practice session with instant feedback, or a timed test that auto-submits when the clock runs out.",
  },
  {
    icon: BarChart3,
    title: "Dashboard & analytics",
    detail:
      "Track accuracy by class, subject, and question type, and review every past attempt in one place.",
  },
  {
    icon: Share2,
    title: "Share & export",
    detail:
      "Publish a read-only link to a chapter or topic, or export the whole set as a file. Revoke a link whenever you like.",
  },
];

const STEPS = [
  {
    step: "01",
    title: "Build your hierarchy",
    detail: "Create classes, subjects, chapters, and topics in minutes.",
  },
  {
    step: "02",
    title: "Author the questions",
    detail: "Write them yourself or generate a first draft with AI.",
  },
  {
    step: "03",
    title: "Practice and measure",
    detail: "Run sessions, then read the analytics to see what stuck.",
  },
];

export default function Landing() {
  const { isAuthenticated: isSignedIn } = useAuth();

  return (
    <div className="flex flex-col">
      {/* Hero */}
      <section
        data-ocid="landing.hero.section"
        className="relative overflow-hidden border-b border-border bg-gradient-subtle"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-24 -top-32 h-96 w-96 rounded-full bg-primary/10 blur-3xl animate-drift"
        />
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-6 py-20 lg:grid-cols-[1.05fr_0.95fr] lg:py-28">
          <div className="animate-fade-up">
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card/70 px-3 py-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <Sparkles className="size-3.5 text-primary" aria-hidden="true" />
              Study platform for serious learners
            </span>

            <h1 className="mt-6 text-balance text-4xl leading-[1.05] sm:text-5xl lg:text-6xl">
              Forge your study material into{" "}
              <span className="text-gradient-primary">real recall</span>.
            </h1>

            <p className="mt-6 max-w-xl text-pretty text-lg leading-relaxed text-muted-foreground">
              StudyForge organises everything you teach or study — classes,
              subjects, chapters, and topics — then turns it into practice
              sessions, timed tests, and analytics that show exactly where the
              gaps are.
            </p>

            <div className="mt-9 flex flex-wrap items-center gap-3">
              {isSignedIn ? (
                <Button
                  asChild
                  size="lg"
                  className="rounded-full bg-gradient-primary text-primary-foreground shadow-sm transition-smooth hover:opacity-90"
                >
                  <Link to="/dashboard" data-ocid="landing.dashboard_button">
                    Go to your dashboard
                    <ArrowRight className="size-4" aria-hidden="true" />
                  </Link>
                </Button>
              ) : (
                <Button
                  asChild
                  size="lg"
                  className="rounded-full bg-gradient-primary text-primary-foreground shadow-sm transition-smooth hover:opacity-90"
                  data-ocid="landing.signin_button"
                >
                  <Link to="/register">
                    Create your account
                    <ArrowRight className="size-4" aria-hidden="true" />
                  </Link>
                </Button>
              )}

              <Button
                asChild
                size="lg"
                variant="outline"
                className="rounded-full border-primary/40 text-primary transition-smooth hover:bg-primary/10 hover:text-primary"
              >
                <Link to="/qr" data-ocid="landing.qr_button">
                  <QrCode className="size-4" aria-hidden="true" />
                  Create a QR code — no sign-in
                </Link>
              </Button>

              <Button
                asChild
                size="lg"
                variant="ghost"
                className="rounded-full text-muted-foreground transition-smooth hover:text-foreground"
              >
                <a href="#features" data-ocid="landing.features_link">
                  See what's inside
                </a>
              </Button>
            </div>

            <p className="mt-5 text-sm text-muted-foreground">
              Use your own email and password, then verify your email before
              opening private study material.
            </p>
          </div>

          <div className="animate-fade-up [animation-delay:120ms]">
            <div className="surface-glass overflow-hidden rounded-2xl p-2">
              {/*
                The JPEG is 656 KB and is the largest thing on this page; the
                same frame as AVIF is 18 KB and as WebP 40 KB. `sizes` matches
                the column the image actually occupies (half the container above
                `lg`, full width below), and the intrinsic ratio is the file's
                real 1376×768 rather than the 1536×1024 its name claims — the
                wrong ratio reserved vertical space that never filled.
              */}
              <picture>
                <source
                  type="image/avif"
                  srcSet="/assets/generated/hero-studyforge.avif"
                  sizes="(min-width: 1024px) 50vw, 92vw"
                />
                <source
                  type="image/webp"
                  srcSet="/assets/generated/hero-studyforge.webp"
                  sizes="(min-width: 1024px) 50vw, 92vw"
                />
                <img
                  src="/assets/generated/hero-studyforge.dim_1536x1024.jpg"
                  alt="An open book, fountain pen, and handwritten index cards on a warm parchment desk"
                  className="h-full w-full rounded-xl object-cover"
                  width={1376}
                  height={768}
                  loading="eager"
                  decoding="async"
                  fetchPriority="high"
                />
              </picture>
            </div>
          </div>
        </div>
      </section>

      {/* Hierarchy */}
      <section
        data-ocid="landing.hierarchy.section"
        className="border-b border-border bg-background"
      >
        <div className="mx-auto max-w-6xl px-6 py-20">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-wider text-primary">
              Structure
            </p>
            <h2 className="mt-3 text-3xl sm:text-4xl">
              Four levels, one clear path
            </h2>
            <p className="mt-4 text-muted-foreground">
              Everything in StudyForge hangs off a single hierarchy, so a
              question always knows exactly where it belongs.
            </p>
          </div>

          <ol className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {HIERARCHY.map((level, index) => (
              <li key={level.label}>
                <Card
                  data-ocid={`landing.hierarchy.item.${index + 1}`}
                  className="h-full rounded-lg border-border shadow-none transition-smooth hover:border-primary/40"
                >
                  <CardContent className="flex h-full flex-col gap-3">
                    <span className="numeric text-sm text-primary">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <h3 className="text-xl">{level.label}</h3>
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      {level.detail}
                    </p>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Question types */}
      <section
        data-ocid="landing.question_types.section"
        className="border-b border-border bg-muted/40"
      >
        <div className="mx-auto max-w-6xl px-6 py-20">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-wider text-primary">
              Question types
            </p>
            <h2 className="mt-3 text-3xl sm:text-4xl">
              Three formats that cover most of what you teach
            </h2>
          </div>

          <div className="mt-12 grid grid-cols-1 gap-4 md:grid-cols-3">
            {QUESTION_TYPES.map((type, index) => (
              <Card
                key={type.name}
                data-ocid={`landing.question_type.item.${index + 1}`}
                className="rounded-lg border-border shadow-none"
              >
                <CardContent className="flex flex-col gap-3">
                  <span className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <type.icon className="size-5" aria-hidden="true" />
                  </span>
                  <h3 className="text-lg">{type.name}</h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {type.detail}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section
        id="features"
        data-ocid="landing.features.section"
        className="scroll-mt-20 border-b border-border bg-background"
      >
        <div className="mx-auto max-w-6xl px-6 py-20">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-wider text-primary">
              Capabilities
            </p>
            <h2 className="mt-3 text-3xl sm:text-4xl">
              Everything from authoring to insight
            </h2>
          </div>

          <div className="mt-12 grid gap-4 sm:grid-cols-2">
            {FEATURES.map((feature, index) => (
              <Card
                key={feature.title}
                data-ocid={`landing.feature.item.${index + 1}`}
                className="rounded-lg border-border shadow-none transition-smooth hover:border-primary/40"
              >
                <CardContent className="flex gap-4">
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
                    <feature.icon className="size-5" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-lg">{feature.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                      {feature.detail}
                    </p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section
        data-ocid="landing.steps.section"
        className="border-b border-border bg-muted/40"
      >
        <div className="mx-auto max-w-6xl px-6 py-20">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-wider text-primary">
              How it works
            </p>
            <h2 className="mt-3 text-3xl sm:text-4xl">
              From empty class to measured progress
            </h2>
          </div>

          <ol className="mt-12 grid grid-cols-1 gap-6 md:grid-cols-3">
            {STEPS.map((item, index) => (
              <li
                key={item.step}
                data-ocid={`landing.step.item.${index + 1}`}
                className="border-t-2 border-primary/30 pt-5"
              >
                <span className="numeric text-sm text-primary">
                  {item.step}
                </span>
                <h3 className="mt-2 text-xl">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {item.detail}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Closing CTA */}
      <section data-ocid="landing.cta.section" className="bg-background">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <div className="surface-glass relative overflow-hidden rounded-2xl px-8 py-14 text-center sm:px-14">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -left-16 -top-20 h-64 w-64 rounded-full bg-primary/15 blur-3xl"
            />
            <div className="relative mx-auto max-w-2xl">
              <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary">
                <Layers className="size-3.5" aria-hidden="true" />
                Start building
              </span>
              <h2 className="mt-4 text-3xl sm:text-4xl">
                Your first class is a few minutes away
              </h2>
              <p className="mt-4 text-muted-foreground">
                Sign in, create a class, and start authoring questions. Share a
                chapter with your students whenever you're ready.
              </p>

              <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                {isSignedIn ? (
                  <Button
                    asChild
                    size="lg"
                    className="rounded-full bg-gradient-primary text-primary-foreground shadow-sm transition-smooth hover:opacity-90"
                  >
                    <Link
                      to="/dashboard"
                      data-ocid="landing.cta_dashboard_button"
                    >
                      Go to your dashboard
                      <ArrowRight className="size-4" aria-hidden="true" />
                    </Link>
                  </Button>
                ) : (
                  <Button
                    asChild
                    size="lg"
                    className="rounded-full bg-gradient-primary text-primary-foreground shadow-sm transition-smooth hover:opacity-90"
                    data-ocid="landing.cta_signin_button"
                  >
                    <Link to="/register">
                      Create your account
                      <ArrowRight className="size-4" aria-hidden="true" />
                    </Link>
                  </Button>
                )}

                <Button
                  asChild
                  size="lg"
                  variant="outline"
                  className="rounded-full border-primary/40 text-primary transition-smooth hover:bg-primary/10 hover:text-primary"
                >
                  <Link to="/qr" data-ocid="landing.cta_qr_button">
                    <QrCode className="size-4" aria-hidden="true" />
                    Make a QR code
                  </Link>
                </Button>
              </div>

              <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
                <span className="inline-flex items-center gap-2">
                  <Clock className="size-4" aria-hidden="true" />
                  Practice and timed modes
                </span>
                <span className="inline-flex items-center gap-2">
                  <Download className="size-4" aria-hidden="true" />
                  Export your content
                </span>
                <span className="inline-flex items-center gap-2">
                  <Share2 className="size-4" aria-hidden="true" />
                  Share read-only links
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
