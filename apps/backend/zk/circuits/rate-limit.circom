pragma circom 2.0.0;

include "comparators.circom";

template RateLimitCheck() {
  signal input count;     // Private input: current count from DB
  signal input limit;     // Public input: the LIMIT (e.g., 10)
  signal output isAllowed; // Public output: 1 if count < limit, else 0

  component lt = LessThan(8); // 8 bits — enough for small counts (up to 255)

  lt.in[0] <== count;
  lt.in[1] <== limit;

  isAllowed <== lt.out;
}

component main {public [limit]} = RateLimitCheck();