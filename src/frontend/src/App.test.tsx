import { ErrorBoundary } from "@/components/common/ErrorBoundary";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function Boom({
  message = "chunk failed to load",
}: { message?: string }): never {
  throw new Error(message);
}

function stubLocation() {
  const reload = vi.fn();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...window.location, reload },
  });
  return reload;
}

describe("ErrorBoundary", () => {
  // React reports a caught render error through console.error as well as the
  // boundary's own componentDidCatch; neither is the subject of these tests.
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("leaves a healthy tree alone", () => {
    render(
      <ErrorBoundary>
        <p>the dashboard</p>
      </ErrorBoundary>,
    );

    expect(screen.getByText("the dashboard")).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /something went wrong/i }),
    ).not.toBeInTheDocument();
  });

  it("replaces a child that throws on render with a named fallback", () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );

    expect(
      screen.getByRole("heading", { name: /something went wrong/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("chunk failed to load")).toBeInTheDocument();
  });

  it("reloads the page from the fallback", async () => {
    const reload = stubLocation();
    render(
      <ErrorBoundary>
        <Boom message={""} />
      </ErrorBoundary>,
    );

    await userEvent.click(screen.getByRole("button", { name: /reload/i }));

    expect(reload).toHaveBeenCalledTimes(1);
  });
});
