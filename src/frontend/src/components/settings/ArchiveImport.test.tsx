import { ArchiveImport } from "@/components/settings/ArchiveImport";
import type { ImportReport } from "@/lib/archiveImport";
import { stringifyWithBigints } from "@/lib/bigintJson";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The import panel, over a stubbed mutation.
 *
 * The importer is tested against a real backend in `archiveImport.test.ts`; what
 * this file pins is the part only the page can get wrong: the move is offered
 * when the device holds data the account does not, it is not offered when the
 * local archive *is* the account, nothing is sent before the confirmation, and
 * the report says out loud which rows arrived and which were left out on purpose.
 */

const LOCAL_KEY = "studyforge.mock-backend.v1";

const harness = vi.hoisted(() => ({
  localAccounts: false,
  isPending: false,
  report: null as ImportReport | null,
  error: null as string | null,
  mutate: vi.fn(),
}));

vi.mock("@/lib/authMode", () => ({
  get USE_LOCAL_ACCOUNTS() {
    return harness.localAccounts;
  },
}));

vi.mock("@/hooks/useArchive", () => ({
  useImportArchive: () => ({
    isPending: harness.isPending,
    mutate: harness.mutate,
  }),
}));

function report(overrides: Partial<ImportReport> = {}): ImportReport {
  return {
    created: {
      classes: 1,
      subjects: 1,
      chapters: 1,
      topics: 2,
      questions: 8,
      notes: 0,
      links: 0,
      settings: 1,
    },
    skipped: {
      classes: 0,
      subjects: 0,
      chapters: 0,
      topics: 0,
      questions: 0,
      notes: 0,
      links: 0,
      settings: 0,
    },
    notRestored: {
      sessions: 3,
      results: 1,
      activity: 5,
      shares: 2,
      noteShares: 0,
    },
    failures: [],
    ...overrides,
  };
}

beforeEach(() => {
  window.localStorage.clear();
  harness.localAccounts = false;
  harness.isPending = false;
  harness.report = null;
  harness.error = null;
  harness.mutate.mockReset();
  harness.mutate.mockImplementation(
    (
      _input: unknown,
      options?: {
        onSuccess?: (value: ImportReport) => void;
        onError?: (error: Error) => void;
      },
    ) => {
      if (harness.error) options?.onError?.(new Error(harness.error));
      else if (harness.report) options?.onSuccess?.(harness.report);
    },
  );
});

/** The archive `src/mocks/backend.ts` leaves behind: one class, one question. */
function storedArchive() {
  window.localStorage.setItem(
    LOCAL_KEY,
    stringifyWithBigints({
      version: 1,
      classes: [{ id: 1n, name: "Class 11" }],
      subjects: [],
      chapters: [],
      topics: [],
      questions: [{ id: 2n, prompt: "What is g?" }],
      notes: [],
      links: [],
      sessions: [{ id: 3n }],
      results: [],
      activity: [],
    }),
  );
}

/** Open the confirmation and accept it, as a person would. */
async function moveItIn(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: /Move it in/u }));
  const dialog = await screen.findByRole("alertdialog");
  await user.click(within(dialog).getByRole("button", { name: "Import" }));
}

describe("ArchiveImport", () => {
  it("offers the file restore even on a device that stores nothing", () => {
    render(<ArchiveImport />);
    expect(
      screen.getByRole("button", { name: /Choose a file/u }),
    ).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: /Move it in/u }),
    ).not.toBeInTheDocument();
  });

  it("counts what this browser holds before asking to move it", async () => {
    storedArchive();
    render(<ArchiveImport />);
    expect(
      await screen.findByText(/1 library entry, 1 question/u),
    ).toBeInTheDocument();
    expect(screen.getByText(/not in your account yet/iu)).toBeInTheDocument();
  });

  it("does not offer to move an archive that already is the account", () => {
    harness.localAccounts = true;
    storedArchive();
    render(<ArchiveImport />);
    expect(
      screen.getByRole("button", { name: /Choose a file/u }),
    ).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: /Move it in/u }),
    ).not.toBeInTheDocument();
  });

  it("sends nothing until the confirmation is accepted", async () => {
    const user = userEvent.setup();
    storedArchive();
    render(<ArchiveImport />);
    await user.click(
      await screen.findByRole("button", { name: /Move it in/u }),
    );
    expect(await screen.findByRole("alertdialog")).toHaveTextContent(
      "Add this data to your account?",
    );
    expect(harness.mutate).not.toHaveBeenCalled();

    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Cancel",
      }),
    );
    expect(harness.mutate).not.toHaveBeenCalled();
    expect(
      screen.queryByText(/practice session were left out/u),
    ).not.toBeInTheDocument();
  });

  it("hands the stored document to the importer once it is accepted", async () => {
    const user = userEvent.setup();
    storedArchive();
    harness.report = report();
    render(<ArchiveImport />);
    await moveItIn(user);

    expect(harness.mutate).toHaveBeenCalledTimes(1);
    const [input] = harness.mutate.mock.calls[0] as [{ text: string }];
    expect(input.text).toContain("What is g?");
  });

  it("says which rows arrived and which parts were left out on purpose", async () => {
    const user = userEvent.setup();
    storedArchive();
    harness.report = report({
      created: { ...report().created, links: 2 },
    });
    render(<ArchiveImport />);
    await moveItIn(user);

    expect(
      await screen.findByText(
        /1 classes, 1 subjects, 1 chapters, 2 topics, 8 questions/u,
      ),
    ).toBeInTheDocument();
    expect(
      await screen.findByText(/3 practice sessions and 1 finished result/u),
    ).toBeInTheDocument();
    expect(
      await screen.findByText(/2 QR links came back with a new code/u),
    ).toBeInTheDocument();
  });

  it("lists the rows the backend refused", async () => {
    const user = userEvent.setup();
    storedArchive();
    harness.report = report({
      failures: [
        { entity: "questions", label: "What is g?", reason: "quota exhausted" },
      ],
    });
    render(<ArchiveImport />);
    await moveItIn(user);

    expect(
      await screen.findByText(/What is g\?: quota exhausted/u),
    ).toBeInTheDocument();
  });

  it("confirms the file a person chose before importing it", async () => {
    const user = userEvent.setup();
    harness.report = report();
    const { container } = render(<ArchiveImport />);
    const input = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    await user.upload(
      input,
      new File(['{"classes":[]}'], "studydesk-export.json", {
        type: "application/json",
      }),
    );

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(/the file "studydesk-export\.json"/u);
    await user.click(within(dialog).getByRole("button", { name: "Import" }));
    expect(harness.mutate).toHaveBeenCalledTimes(1);
    const [sent] = harness.mutate.mock.calls[0] as [{ text: string }];
    expect(sent.text).toBe('{"classes":[]}');
  });
});
