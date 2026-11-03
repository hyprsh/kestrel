"""Tests of seed.py's grab_blu_ray. Run: python3 -I scripts/demo/test_seed_grab.py

seed.py is a script that seeds a running Kestrel as soon as it is run, so the function is read out of its source
and run here against a fake `call`.
"""
import ast
import os
import unittest

SRC = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "seed.py")).read()
_fn = next(n for n in ast.parse(SRC).body if isinstance(n, ast.FunctionDef) and n.name == "grab_blu_ray")
_ns = {}
exec(compile(ast.Module([_fn], []), "seed.py", "exec"), _ns)
grab_blu_ray = _ns["grab_blu_ray"]

RELEASES = {"items": [
    {"release_id": "a", "name": "Paddington.in.Peru.2160p.WEB-DL", "fits": False},
    {"release_id": "b", "name": "Paddington.in.Peru.1080p.BluRay.x264-GRP", "fits": True},
]}


def api(grab_errors):
    """A `call` that answers every search with RELEASES and each POST /grabs with the next of grab_errors (None: accepted)."""
    log, errors = [], list(grab_errors)

    def call(method, path, body=None):
        log.append((method, path))
        if path.endswith("/releases"):
            return RELEASES
        err = errors.pop(0)
        if err is not None:
            raise SystemExit(f"seed: {method} {path}: 409 {err}")
        return {}

    return call, log


class GrabBluRay(unittest.TestCase):
    def test_grabs_the_blu_ray_after_one_search(self):
        call, log = api([None])
        grab_blu_ray(call, 7)
        self.assertEqual([p for _, p in log], ["/versions/7/releases", "/grabs"])

    def test_searches_again_and_retries_once_on_release_expired(self):
        call, log = api(['{"code":"release_expired"}', None])
        grab_blu_ray(call, 7)
        self.assertEqual([p for _, p in log], ["/versions/7/releases", "/grabs", "/versions/7/releases", "/grabs"])

    def test_fails_naming_the_step_when_the_retry_expires_too(self):
        call, log = api(['{"code":"release_expired"}', '{"code":"release_expired"}'])
        with self.assertRaises(SystemExit) as cm:
            grab_blu_ray(call, 7)
        self.assertIn("the Grab downloading", str(cm.exception))
        self.assertIn("release_expired", str(cm.exception))
        self.assertEqual(len(log), 4)  # no third try

    def test_tolerates_already_downloading_without_a_retry(self):
        call, log = api(["Release already downloading"])
        grab_blu_ray(call, 7)
        self.assertEqual(len(log), 2)

    def test_tolerates_already_downloading_on_the_retry(self):
        call, log = api(['{"code":"release_expired"}', "Release already downloading"])
        grab_blu_ray(call, 7)
        self.assertEqual(len(log), 4)

    def test_does_not_retry_another_failure(self):
        call, log = api(["boom"])
        with self.assertRaises(SystemExit) as cm:
            grab_blu_ray(call, 7)
        self.assertIn("the Grab downloading", str(cm.exception))
        self.assertEqual(len(log), 2)


if __name__ == "__main__":
    unittest.main()
