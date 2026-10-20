from decimal import Decimal, ROUND_HALF_UP
import math

def main():
    print("division:", 7 / 2, -7 // 2, -7 % 2)
    print("float equal:", 0.1 + 0.2 == 0.3)
    print("float close:", math.isclose(0.1 + 0.2, 0.3))
    amount = Decimal("0.10") + Decimal("0.20")
    print("decimal:", amount)
    print("rounded:", Decimal("2.345").quantize(
        Decimal("0.01"), rounding=ROUND_HALF_UP))
    print("truth:", bool("false"), bool(""), bool(0))
    print("fallback:", 0 or 10)
    print("bool is int:", isinstance(True, int))
    print("nan equal:", math.nan == math.nan)

if __name__ == "__main__":
    main()
