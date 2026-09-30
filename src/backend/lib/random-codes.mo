import Blob "mo:core/Blob";
import Int "mo:core/Int";
import Random "mo:core/Random";
import VarArray "mo:core/VarArray";

module {
  /// Batched CSPRNG for short codes and secret tokens.
  ///
  /// `Random.blob()` is the platform CSPRNG (a management-canister `raw_rand`
  /// call). On a replicated subnet every `await` costs one consensus round
  /// trip, so drawing one random index per character made a single short link
  /// — a ten-character code and a 32-character edit token — cost ~42
  /// consensus round trips. This module draws 32 bytes at once and derives
  /// every character locally, calling the CSPRNG again only when the buffer
  /// runs dry.
  ///
  /// The buffer lives in the actor (declared `transient` in `main.mo`, the
  /// same treatment the rate-limit windows get): it resets to empty on an
  /// upgrade and is refilled from the CSPRNG on the next draw, so nothing
  /// here reaches the stable layout.

  /// Leftover entropy from the last `raw_rand` call, with a cursor into it.
  public type Entropy = { var buffer : [Nat8]; var cursor : Nat };

  public func newEntropy() : Entropy = { var buffer = []; var cursor = 0 };

  /// Next uniform index in `[0, alphabetSize)`, rejection-sampled on whole
  /// bytes: values from `acceptBelow` up would over-represent the first
  /// `256 % alphabetSize` letters of the alphabet, so they are redrawn. The
  /// same no-modulo-bias rule `lib/supabase/tokens.ts` and the mock backend's
  /// `randomAlphabet()` follow.
  func nextIndex(entropy : Entropy, alphabetSize : Nat) : async* Nat {
    // Int arithmetic so the subtraction cannot trap: the remainder is always
    // below 256, so `acceptBelow` stays in 1..256.
    let acceptBelow = Int.toNat(256 - (256 % Nat.toInt(alphabetSize)));
    loop {
      if (entropy.cursor >= entropy.buffer.size()) {
        entropy.buffer := Blob.toArray(await Random.blob());
        entropy.cursor := 0;
      };
      let byte = entropy.buffer[entropy.cursor];
      entropy.cursor += 1;
      if (byte.toNat() < acceptBelow) {
        return byte.toNat() % alphabetSize;
      };
    };
  };

  /// Build a random string of `length` characters from `alphabet`. The whole
  /// string costs at most one `raw_rand` round trip per 32 bytes of alphabet
  /// entropy it consumes, not one per character.
  public func randomText(entropy : Entropy, alphabet : Text, length : Nat) : async Text {
    let alphabetChars = alphabet.toArray();
    let chars = VarArray.repeat(' ', length);
    var i = 0;
    while (i < length) {
      let index = await* nextIndex(entropy, alphabetChars.size());
      chars[i] := alphabetChars[index];
      i += 1;
    };
    chars.toArray().toText();
  };
};
