#!/usr/bin/env python3
"""Advisory Commander construction probabilities and Rebell-style comparisons."""

from __future__ import annotations

import argparse
import json
import math
from typing import NamedTuple

DEFAULT_LIBRARY_SIZE = 99
DEFAULT_OPENING_HAND = 7


def validate_population(library_size: int, copies: int, seen: int) -> None:
    if library_size < 1:
        raise ValueError("library size must be positive")
    if not 0 <= copies <= library_size:
        raise ValueError("copies must be between zero and the library size")
    if not 0 <= seen <= library_size:
        raise ValueError("cards seen must be between zero and the library size")


def hypergeometric_exact(
    library_size: int,
    copies: int,
    seen: int,
    hits: int,
) -> float:
    validate_population(library_size, copies, seen)
    misses = seen - hits
    if hits < 0 or hits > copies or misses < 0 or misses > library_size - copies:
        return 0.0
    return (
        math.comb(copies, hits)
        * math.comb(library_size - copies, misses)
        / math.comb(library_size, seen)
    )


def hypergeometric_at_least(
    library_size: int,
    copies: int,
    seen: int,
    minimum_hits: int = 1,
) -> float:
    validate_population(library_size, copies, seen)
    if minimum_hits <= 0:
        return 1.0
    return sum(
        hypergeometric_exact(library_size, copies, seen, hits)
        for hits in range(minimum_hits, min(copies, seen) + 1)
    )


def engine_online_probability(
    library_size: int,
    enablers: int,
    payoffs: int,
    seen: int,
    overlap: int = 0,
) -> float:
    if enablers < 0 or payoffs < 0:
        raise ValueError("package counts cannot be negative")
    if not 0 <= overlap <= min(enablers, payoffs):
        raise ValueError("overlap must fit inside both engine packages")
    union = enablers + payoffs - overlap
    if union > library_size:
        raise ValueError("enablers and payoffs exceed the library size")
    validate_population(library_size, union, seen)

    total = math.comb(library_size, seen)
    no_enabler = math.comb(library_size - enablers, seen)
    no_payoff = math.comb(library_size - payoffs, seen)
    neither = math.comb(library_size - union, seen)
    return 1 - (no_enabler + no_payoff - neither) / total


def cards_seen_by_turn(turn: int, opening_hand: int = DEFAULT_OPENING_HAND) -> int:
    if turn < 0:
        raise ValueError("turn cannot be negative")
    if opening_hand < 0:
        raise ValueError("opening hand cannot be negative")
    return opening_hand + turn


class RampDrawAdvice(NamedTuple):
    threshold: int
    ramp: int
    draw: int
    combined: int = 24


def ramp_draw_advice(threshold: int) -> RampDrawAdvice:
    if threshold < 1:
        raise ValueError("operational threshold must be at least one")
    if threshold <= 2:
        return RampDrawAdvice(threshold, ramp=8, draw=16)
    if threshold == 3:
        return RampDrawAdvice(threshold, ramp=10, draw=14)
    if threshold == 4:
        return RampDrawAdvice(threshold, ramp=12, draw=12)
    return RampDrawAdvice(threshold, ramp=14, draw=10)


def percent(probability: float) -> float:
    return round(probability * 100, 1)


def odds_payload(args: argparse.Namespace) -> dict[str, object]:
    probability = hypergeometric_at_least(
        args.library_size,
        args.copies,
        args.seen,
        args.at_least,
    )
    return {
        "model": "hypergeometric without replacement",
        "library_size": args.library_size,
        "copies": args.copies,
        "cards_seen": args.seen,
        "at_least": args.at_least,
        "probability": probability,
        "percent": percent(probability),
    }


def profile_payload(args: argparse.Namespace) -> dict[str, object]:
    seen = cards_seen_by_turn(args.turn, args.opening_hand)
    if seen > args.library_size:
        raise ValueError("cards seen by turn exceeds the library size")

    advice = ramp_draw_advice(args.threshold)
    roles = {
        "ramp": args.ramp,
        "draw": args.draw,
        "interaction": args.interaction,
        "enablers": args.enablers,
        "payoffs": args.payoffs,
        "enhancers": args.enhancers,
    }
    validate_population(args.library_size, args.lands, seen)
    for name, copies in roles.items():
        validate_population(args.library_size, copies, seen)

    return {
        "assumptions": {
            "library_size": args.library_size,
            "opening_hand": args.opening_hand,
            "turn": args.turn,
            "cards_seen": seen,
            "mulligans": "not modeled",
            "selection_and_tutors": "not modeled",
            "overlap": "counts are independent role views, not additive slots",
        },
        "rebell_advice": {
            **advice._asdict(),
            "label": "Rebell ramp/draw comparison point, not a target",
        },
        "role_odds_by_turn": {
            name: {
                "copies": copies,
                "at_least_one_percent": percent(
                    hypergeometric_at_least(
                        args.library_size,
                        copies,
                        seen,
                    )
                ),
            }
            for name, copies in roles.items()
        },
        "raw_land_drop_odds": {
            "needed": args.land_drops,
            "percent": percent(
                hypergeometric_at_least(
                    args.library_size,
                    args.lands,
                    seen,
                    args.land_drops,
                )
            ),
            "warning": (
                "Does not count ramp, MDFCs outside the land count, "
                "landcycling, draw, or mulligans"
            ),
        },
        "engine_online_odds": {
            "definition": "at least one enabler and at least one payoff",
            "cards_in_both_packages": args.engine_overlap,
            "percent": percent(
                engine_online_probability(
                    args.library_size,
                    args.enablers,
                    args.payoffs,
                    seen,
                    args.engine_overlap,
                )
            ),
        },
    }


def add_shared_population_options(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--library-size", type=int, default=DEFAULT_LIBRARY_SIZE)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Exact probabilities and advisory Rebell-style construction "
            "comparisons. The output is evidence, not a deck-building verdict."
        )
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    odds = subparsers.add_parser("odds", help="probability of drawing a package")
    add_shared_population_options(odds)
    odds.add_argument("--copies", type=int, required=True)
    odds.add_argument("--seen", type=int, required=True)
    odds.add_argument("--at-least", type=int, default=1)
    odds.set_defaults(payload=odds_payload)

    profile = subparsers.add_parser(
        "profile",
        help="compare one deck's role counts and engine availability",
    )
    add_shared_population_options(profile)
    profile.add_argument("--threshold", type=int, required=True)
    profile.add_argument("--turn", type=int, default=4)
    profile.add_argument("--opening-hand", type=int, default=DEFAULT_OPENING_HAND)
    profile.add_argument("--land-drops", type=int, default=4)
    profile.add_argument("--lands", type=int, required=True)
    profile.add_argument("--ramp", type=int, required=True)
    profile.add_argument("--draw", type=int, required=True)
    profile.add_argument("--interaction", type=int, required=True)
    profile.add_argument("--enablers", type=int, required=True)
    profile.add_argument("--payoffs", type=int, required=True)
    profile.add_argument("--engine-overlap", type=int, default=0)
    profile.add_argument("--enhancers", type=int, default=0)
    profile.set_defaults(payload=profile_payload)

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    try:
        payload = args.payload(args)
    except ValueError as error:
        parser.error(str(error))
    print(json.dumps(payload, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
