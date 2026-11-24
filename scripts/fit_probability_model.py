"""Calibrate and cross-validate the continuous empirical naked-eye sighting
probability model on enriched South African historical decisions (1429-1448 AH).
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from scipy.optimize import minimize

ROOT = Path(__file__).resolve().parent.parent
INPUT_PATH = ROOT / "data" / "sa_enriched_history.json"
OUT_SRC = ROOT / "src" / "data" / "empirical_model.json"
OUT_DATA = ROOT / "data" / "empirical_model.json"

MIN_ARCL_DEG = 6.4
MIN_LAG_MIN = 0.0
K_EFF_DEFAULT = 2.5


def sigmoid(z: np.ndarray) -> np.ndarray:
    z = np.clip(z, -30.0, 30.0)
    return 1.0 / (1.0 + np.exp(-z))


def fit_logistic(X: np.ndarray, y: np.ndarray, l2: float = 0.05) -> np.ndarray:
    """Fit L2-regularized logistic regression via BFGS."""
    n_feat = X.shape[1]

    def loss(w: np.ndarray) -> float:
        p = sigmoid(X @ w)
        eps = 1e-12
        nll = -np.mean(y * np.log(p + eps) + (1.0 - y) * np.log(1.0 - p + eps))
        reg = 0.5 * l2 * np.sum(w[1:] ** 2) / len(y)
        return float(nll + reg)

    def grad(w: np.ndarray) -> np.ndarray:
        p = sigmoid(X @ w)
        g = (X.T @ (p - y)) / len(y)
        g[1:] += l2 * w[1:] / len(y)
        return g

    res = minimize(loss, np.zeros(n_feat), jac=grad, method="BFGS")
    return res.x


def roc_auc_score(y_true: np.ndarray, y_score: np.ndarray) -> float:
    """Compute exact Mann-Whitney ROC AUC without needing scikit-learn."""
    pos = y_score[y_true == 1]
    neg = y_score[y_true == 0]
    if len(pos) == 0 or len(neg) == 0:
        return 0.5
    diff = pos[:, None] - neg[None, :]
    return float(np.mean((diff > 0) + 0.5 * (diff == 0)))


def stratified_kfold_indices(y: np.ndarray, k: int = 5, seed: int = 42) -> list[tuple[np.ndarray, np.ndarray]]:
    rng = np.random.default_rng(seed)
    pos_idx = rng.permutation(np.where(y == 1)[0])
    neg_idx = rng.permutation(np.where(y == 0)[0])
    folds: list[list[int]] = [[] for _ in range(k)]
    for i, idx in enumerate(pos_idx):
        folds[i % k].append(int(idx))
    for i, idx in enumerate(neg_idx):
        folds[i % k].append(int(idx))
    out = []
    all_idx = np.arange(len(y))
    for f in range(k):
        val = np.array(sorted(folds[f]))
        trn = np.setdiff1d(all_idx, val)
        out.append((trn, val))
    return out


def is_feasible(row: dict) -> bool:
    return (
        row["sa_best_lag"] > MIN_LAG_MIN
        and row["sa_best_arcl"] >= MIN_ARCL_DEG
        and (row["sa_best_age"] is None or row["sa_best_age"] > 0)
    )


def main() -> None:
    rows = json.loads(INPUT_PATH.read_text(encoding="utf-8"))
    y_all = np.array([1 if r["sighted"] else 0 for r in rows], dtype=float)
    feasible = np.array([is_feasible(r) for r in rows], dtype=bool)
    q_all = np.array([r["sa_best_q"] for r in rows], dtype=float)
    arcv_all = np.array([r["sa_best_arcv"] for r in rows], dtype=float)
    w_all = np.array([r["sa_best_w"] for r in rows], dtype=float)
    lag_all = np.array([r["sa_best_lag"] for r in rows], dtype=float)

    # 5-fold stratified CV comparing 1D Yallop-q logistic vs 3D (arcv, w, lag) logistic
    folds = stratified_kfold_indices(y_all, k=5, seed=42)
    oof_q = np.zeros(len(rows))
    oof_3d = np.zeros(len(rows))

    for trn, val in folds:
        trn_f = trn[feasible[trn]]
        # Model A: 1D q
        Xq_trn = np.column_stack([np.ones(len(trn_f)), q_all[trn_f]])
        wq = fit_logistic(Xq_trn, y_all[trn_f], l2=0.05)
        Xq_val = np.column_stack([np.ones(len(val)), q_all[val]])
        p_val_q = np.where(feasible[val], sigmoid(Xq_val @ wq), 0.0)
        oof_q[val] = p_val_q

        # Model B: standardized (arcv, w, lag)
        mu = np.array([arcv_all[trn_f].mean(), w_all[trn_f].mean(), lag_all[trn_f].mean()])
        sd = np.array([arcv_all[trn_f].std() + 1e-6, w_all[trn_f].std() + 1e-6, lag_all[trn_f].std() + 1e-6])
        Z_trn = (np.column_stack([arcv_all[trn_f], w_all[trn_f], lag_all[trn_f]]) - mu) / sd
        Z_val = (np.column_stack([arcv_all[val], w_all[val], lag_all[val]]) - mu) / sd
        w3 = fit_logistic(np.column_stack([np.ones(len(trn_f)), Z_trn]), y_all[trn_f], l2=0.2)
        p_val_3d = np.where(feasible[val], sigmoid(np.column_stack([np.ones(len(val)), Z_val]) @ w3), 0.0)
        oof_3d[val] = p_val_3d

    def eval_metrics(p: np.ndarray) -> dict:
        eps = 1e-12
        brier = float(np.mean((p - y_all) ** 2))
        logloss = float(-np.mean(y_all * np.log(p + eps) + (1.0 - y_all) * np.log(1.0 - p + eps)))
        acc = float(np.mean((p >= 0.5) == (y_all == 1)))
        auc = roc_auc_score(y_all, p)
        return {"brier_score": round(brier, 4), "log_loss": round(logloss, 4), "accuracy": round(acc, 4), "roc_auc": round(auc, 4)}

    m_q = eval_metrics(oof_q)
    m_3d = eval_metrics(oof_3d)
    print("5-Fold CV Model A (1D q-logistic + physical bounds):", m_q)
    print("5-Fold CV Model B (3D arcv/w/lag + physical bounds):", m_3d)

    # Fit final Model A on all feasible SA observations
    Xq_full = np.column_stack([np.ones(np.sum(feasible)), q_all[feasible]])
    w_final = fit_logistic(Xq_full, y_all[feasible], l2=0.05)
    b0, b1 = float(w_final[0]), float(w_final[1])
    q50 = -b0 / b1 if abs(b1) > 1e-9 else 0.0
    p_full = np.where(feasible, sigmoid(b0 + b1 * q_all), 0.0)

    # Calibration / reliability bins
    bins = [
        ("Below Danjon / Moonset <= Sunset", -99.0, -0.25),
        ("Very Thin / Marginal (q -0.25 to -0.05)", -0.25, -0.05),
        ("Transition Zone (q -0.05 to +0.08)", -0.05, 0.08),
        ("Clear-Sky Naked Eye (q +0.08 to +0.25)", 0.08, 0.25),
        ("Easily Visible (q +0.25 to +0.55)", 0.25, 0.55),
        ("High Crescent (q > +0.55)", 0.55, 99.0),
    ]
    cal_bins = []
    for label, qmin, qmax in bins:
        mask = (q_all >= qmin) & (q_all < qmax)
        n = int(np.sum(mask))
        k = int(np.sum(y_all[mask])) if n > 0 else 0
        cal_bins.append({
            "label": label,
            "q_min": qmin,
            "q_max": qmax,
            "n": n,
            "k": k,
            "empirical_rate": round(k / n, 4) if n > 0 else None,
            "predicted_mean": round(float(np.mean(p_full[mask])), 4) if n > 0 else None,
        })

    print(f"\nFinal calibrated model: b0={b0:.4f}, b1={b1:.4f}, q50_midpoint={q50:.4f}")
    print("Calibration bins:")
    for cb in cal_bins:
        print(f"  {cb['label']:42s} | {cb['k']:2d}/{cb['n']:2d} = {cb['empirical_rate']} (pred {cb['predicted_mean']})")

    compact_obs = []
    for r in rows:
        compact_obs.append({
            "hy": r["hijri_year"],
            "hm": r["hijri_month_num"],
            "hname": r["hijri_month_name"],
            "ev": r["decision_evening"],
            "start": r["first_of_month"],
            "eid": r["eid_date"],
            "sighted": r["sighted"],
            "best_st": r["best_station"],
            "sa_best_q": r["sa_best_q"],
            "sa_best_v": r["sa_best_v"],
            "arcv": r["sa_best_arcv"],
            "w": r["sa_best_w"],
            "arcl": r["sa_best_arcl"],
            "lag": r["sa_best_lag"],
            "age": r["sa_best_age"],
            "cities": r["observer_cities"],
            "src": r["sources"],
        })

    payload = {
        "model": {
            "name": "South Africa COSSA/UUCSA Empirical Naked-Eye Logistic",
            "b0": round(b0, 6),
            "b1": round(b1, 6),
            "k_eff": K_EFF_DEFAULT,
            "hard_limits": {"min_arcl_deg": MIN_ARCL_DEG, "min_lag_min": MIN_LAG_MIN},
            "cv_metrics": {
                "n_samples": int(len(rows)),
                "n_feasible": int(np.sum(feasible)),
                "n_sighted": int(np.sum(y_all)),
                "n_not_sighted": int(len(rows) - np.sum(y_all)),
                "q50_midpoint": round(q50, 4),
                **m_q,
                "comparison_3d_brier": m_3d["brier_score"],
                "comparison_3d_auc": m_3d["roc_auc"],
            },
        },
        "calibration_bins": cal_bins,
        "historical_observations": compact_obs,
    }

    OUT_SRC.parent.mkdir(parents=True, exist_ok=True)
    OUT_SRC.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    OUT_DATA.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Saved empirical model -> {OUT_SRC}")


if __name__ == "__main__":
    main()
