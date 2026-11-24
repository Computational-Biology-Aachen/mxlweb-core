"""Generate MxlPy reference fixtures for terms and hidden-state nn_blocks.

Each case is saved with `mxlpy.serialize.save` (spec 0.5 `.mxl.json` plus the
weights sidecars) next to `expected.json`: MxlPy's right-hand side and term
contributions at one test point. `tests/termsParity.test.ts` loads the files
with `mxlJsonToModel` and checks mxlweb-core against them.

Run from the meta-repo's MxlPy checkout (any env with mxlpy >= 0.75):

    uv run --project ../../pkg-py/MxlPy python scripts/gen-term-fixtures.py
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path

import numpy as np
import sympy

from mxlpy import Model, OdeModelBuilder, fns, serialize

OUT = Path(__file__).resolve().parent.parent / "tests" / "assets" / "terms"


def _randomise_weights(model: Model | OdeModelBuilder, seed: int) -> None:
    """Weights of order 1, so every contribution is far from zero."""
    rng = np.random.default_rng(seed)
    model.update_addressable(
        {n: float(rng.normal(0, 0.7)) for n in model.get_weight_names()}
    )


def kinetic() -> Model:
    """Variable and reaction terms, a hidden block on variables, one on reactions."""
    S, P, k3, c = sympy.symbols("S P k3 c")
    m = (
        Model()
        .add_parameters({"k1": 1.2, "k2": 0.4, "k3": 0.3, "c": 0.5})
        .add_variables({"S": 2.0, "P": 0.5})
        .add_reaction(
            "v1",
            fns.mass_action_1s,
            args=["S", "k1"],
            stoichiometry={"S": -1, "P": 1},
        )
        .add_reaction(
            "v2", fns.mass_action_1s, args=["P", "k2"], stoichiometry={"P": -1}
        )
    )
    m.add_term("t_S", -k3 * S, target="S", mechanism="additive")
    m.add_term("t_v1", c * P, target="v1", mechanism="relative")
    m.add_term("t_S2", sympy.Float(0.2) * P, target="S", mechanism="relative")
    m.add_hidden_states(
        "aug",
        n_hidden=2,
        layers=(3,),
        targets=["S", "P"],
        mechanism="relative",
        inputs=["S", "P"],
        input_scales={"S": 2.0},
        seed=1,
    )
    m.update_hidden_states("aug", output_scales={"P": 0.25})
    m.add_hidden_states(
        "rx",
        n_hidden=1,
        layers=(2,),
        activation="softplus",
        targets=["v2"],
        mechanism="additive",
        inputs=["P", "time"],
        seed=2,
    )
    _randomise_weights(m, 3)
    m.update_variable("aug_h0", 0.3)
    m.update_variable("rx_h0", -0.2)
    return m


def ode() -> OdeModelBuilder:
    """A callable mechanism and a hidden block with sigmoid layers."""
    x, y, a = sympy.symbols("x y a")
    m = (
        OdeModelBuilder()
        .add_parameters({"a": 0.8, "b": 0.3})
        .add_diff_eq("x", 1.0, sympy.Symbol("a") * x - x * y)
        .add_diff_eq("y", 0.7, x * y - sympy.Symbol("b") * y)
    )
    m.add_term(
        "damp",
        a * y,
        target="y",
        mechanism=lambda base, term: base - term * base,
    )
    m.add_hidden_states(
        "mem",
        n_hidden=2,
        layers=(4, 3),
        activation="sigmoid",
        targets=["x"],
        mechanism="additive",
        seed=4,
    )
    _randomise_weights(m, 5)
    m.update_variable("mem_h1", 0.4)
    return m


def write(name: str, model: Model | OdeModelBuilder, point: dict[str, float]) -> None:
    folder = OUT / name
    shutil.rmtree(folder, ignore_errors=True)
    folder.mkdir(parents=True)
    serialize.save(model, folder / "model.mxl.json", model_id=name)
    time = 0.7
    rhs = model.get_right_hand_side(point, time)
    args = model.get_args(point, time, include_terms=True)
    terms = [t for t in model.get_term_names() if not t.split("_")[-1].startswith("dh")]
    expected = {
        "time": time,
        "variables": point,
        "rhs": {k: float(v) for k, v in rhs.items()},
        "contributions": {k: float(args[k]) for k in terms},
    }
    (folder / "expected.json").write_text(json.dumps(expected, indent=2) + "\n")


if __name__ == "__main__":
    write(
        "kinetic",
        kinetic(),
        {"S": 1.3, "P": 0.6, "aug_h0": 0.2, "aug_h1": -0.4, "rx_h0": 0.5},
    )
    write("ode", ode(), {"x": 0.9, "y": 1.1, "mem_h0": -0.3, "mem_h1": 0.6})
