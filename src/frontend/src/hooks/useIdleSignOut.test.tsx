/**
 * Idle sign-out.
 *
 * The timer is the whole feature, so these drive the clock and the window's own
 * events rather than any DOM. What they pin is the two ways this could be wrong
 * in opposite directions: a ceiling that never fires leaves a shared computer
 * signed in forever, and one that fires without listening for activity logs a
 * reader out of their own session mid-page.
 */
import { useIdleSignOut } from "@/hooks/useIdleSignOut";
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const IDLE_TIMEOUT_MS = 30 * 60_000;

const auth = vi.hoisted(() => ({
  isAuthenticated: true,
  signOut: vi.fn(),
}));

const mode = vi.hoisted(() => ({ USE_SUPABASE: true }));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => auth,
}));

vi.mock("@/lib/authMode", () => ({
  DATA_BACKEND: "supabase",
  SHARED_BACKEND: true,
  USE_LOCAL_ACCOUNTS: false,
  get USE_SUPABASE() {
    return mode.USE_SUPABASE;
  },
}));

vi.mock("sonner", () => ({ toast: { info: vi.fn(), error: vi.fn() } }));

describe("useIdleSignOut", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    auth.isAuthenticated = true;
    auth.signOut.mockClear();
    mode.USE_SUPABASE = true;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("ends the session once the page has been quiet for half an hour", () => {
    renderHook(() => useIdleSignOut());

    vi.advanceTimersByTime(IDLE_TIMEOUT_MS - 1);
    expect(auth.signOut).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(auth.signOut).toHaveBeenCalledTimes(1);
  });

  it("starts the clock again on any activity, so a reader is never logged out mid-page", () => {
    renderHook(() => useIdleSignOut());

    vi.advanceTimersByTime(IDLE_TIMEOUT_MS - 1000);
    window.dispatchEvent(new Event("pointermove"));
    vi.advanceTimersByTime(2000);
    expect(auth.signOut).not.toHaveBeenCalled();

    vi.advanceTimersByTime(IDLE_TIMEOUT_MS);
    expect(auth.signOut).toHaveBeenCalledTimes(1);
  });

  it("has nothing to end when nobody is signed in", () => {
    auth.isAuthenticated = false;

    renderHook(() => useIdleSignOut());
    vi.advanceTimersByTime(IDLE_TIMEOUT_MS * 3);

    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it("stays out of the dev mock and Internet Identity modes, whose sessions it is not ours to end", () => {
    mode.USE_SUPABASE = false;

    renderHook(() => useIdleSignOut());
    vi.advanceTimersByTime(IDLE_TIMEOUT_MS * 3);

    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it("stops listening when the shell unmounts", () => {
    const { unmount } = renderHook(() => useIdleSignOut());
    unmount();

    vi.advanceTimersByTime(IDLE_TIMEOUT_MS * 2);
    expect(auth.signOut).not.toHaveBeenCalled();
  });
});
