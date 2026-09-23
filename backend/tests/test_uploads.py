"""Upload lifecycle tests and real HTTP/worker integration in isolated outputs."""
import asyncio
import hashlib
import io
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
from tempfile import TemporaryDirectory
from time import monotonic, sleep
import unittest
from unittest.mock import patch
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from uuid import uuid4

from fastapi import BackgroundTasks, HTTPException, UploadFile
import pyarrow as pa
import pyarrow.parquet as pq

from backend.app.analytics.config import AnalysisConfig
from backend.app.analytics.pipeline import CSV_FIELDS, release_run, reserve_run, run_analysis
from backend.app.data import DATA_DIR
from backend.app.jobs import read_state, supervise_job
from backend.app.runs import create_run, get_run, snapshot

PROJECT = DATA_DIR.parent


class UploadLifecycleTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.out = Path(self.temp.name) / 'out'
        self.path_patch = patch('backend.app.runs.output_dir', return_value=self.out)
        self.path_patch.start()
        self.addCleanup(self.path_patch.stop)
        self.files = [UploadFile(file=io.BytesIO(b'content'), filename='../../escape.parquet') for _ in range(3)]
        self.background = BackgroundTasks()

    def accept(self):
        return asyncio.run(create_run(self.background, *self.files))

    def test_fixed_filenames_queued_state_and_background_registration(self):
        response = self.accept()
        directory = self.out / 'jobs' / response.run_id
        self.assertEqual(response.status, 'queued')
        self.assertEqual({p.name for p in (directory / 'uploads').iterdir()},
                         {'nodes.parquet', 'edges.parquet', 'transactions.parquet'})
        self.assertFalse((self.out / 'escape.parquet').exists())
        self.assertEqual(len(self.background.tasks), 1)
        self.assertEqual(get_run(response.run_id)['stage'], 'queued')
        self.assertEqual(json.loads((directory / 'config.json').read_text()), AnalysisConfig().model_dump(mode='json'))
        self.assertTrue(all(f.file.closed for f in self.files))

    def test_busy_slot_returns_409_and_does_not_remove_owner(self):
        owner = uuid4().hex
        reserve_run(self.out, owner)
        with self.assertRaises(HTTPException) as error:
            self.accept()
        self.assertEqual(error.exception.status_code, 409)
        self.assertEqual(json.loads((self.out / '.analysis.lock/owner.json').read_text())['run_id'], owner)
        self.assertFalse((self.out / 'jobs').exists())

    def test_oversized_upload_returns_413_and_cleans_partial_files(self):
        with patch('backend.app.runs.MAX_UPLOAD_BYTES', 3):
            with self.assertRaises(HTTPException) as error:
                self.accept()
        self.assertEqual(error.exception.status_code, 413)
        self.assertFalse((self.out / '.analysis.lock').exists())
        self.assertEqual(list((self.out / 'jobs').iterdir()), [])

    def test_storage_failure_returns_503_and_releases_slot(self):
        with patch('backend.app.runs.save_upload', side_effect=OSError('disk unavailable')):
            with self.assertRaises(HTTPException) as error:
                self.accept()
        self.assertEqual(error.exception.status_code, 503)
        self.assertFalse((self.out / '.analysis.lock').exists())

    def test_bad_server_configuration_does_not_leave_a_queued_job(self):
        with patch('backend.app.runs.load_config', side_effect=ValueError('invalid config')):
            with self.assertRaises(HTTPException) as error:
                self.accept()
        self.assertEqual(error.exception.status_code, 503)
        self.assertEqual(list((self.out / 'jobs').iterdir()), [])
        self.assertFalse((self.out / '.analysis.lock').exists())
        self.assertEqual(self.background.tasks, [])

    def test_cancelled_save_releases_slot(self):
        with patch('backend.app.runs.save_upload', side_effect=asyncio.CancelledError):
            with self.assertRaises(asyncio.CancelledError):
                self.accept()
        self.assertFalse((self.out / '.analysis.lock').exists())

    def test_cancelled_close_does_not_accept_an_unlaunchable_job(self):
        async def cancelled_close():
            raise asyncio.CancelledError()
        self.files[0].close = cancelled_close
        with self.assertRaises(asyncio.CancelledError):
            self.accept()
        self.assertFalse((self.out / '.analysis.lock').exists())
        self.assertEqual(self.background.tasks, [])

    def test_pending_result_is_409_unknown_id_is_404(self):
        response = self.accept()
        with self.assertRaises(HTTPException) as error:
            snapshot(response.run_id)
        self.assertEqual(error.exception.status_code, 409)
        self.assertEqual(error.exception.detail['details']['status'], 'queued')
        for run_id in ('../bad', uuid4().hex):
            with self.assertRaises(HTTPException) as error:
                get_run(run_id)
            self.assertEqual(error.exception.status_code, 404)

    def test_process_start_failure_marks_job_failed_and_cleans_up(self):
        response = self.accept()
        with patch('backend.app.jobs.subprocess.Popen', side_effect=OSError('cannot spawn')):
            with self.assertLogs('backend.app.jobs', level='ERROR'):
                supervise_job(self.out, response.run_id)
        state = read_state(self.out, response.run_id)
        self.assertEqual(state['status'], 'failed')
        self.assertEqual(state['error']['code'], 'worker_failed')
        self.assertFalse((self.out / '.analysis.lock').exists())
        self.assertFalse((self.out / 'jobs' / response.run_id / 'uploads').exists())

    def test_abnormal_worker_exit_marks_failed_and_cleans_pending_snapshot(self):
        response = self.accept()
        pending = self.out / 'runs' / ('.pending-' + response.run_id)
        pending.mkdir(parents=True)
        with patch('backend.app.jobs.subprocess.Popen') as process:
            process.return_value.wait.return_value = -9
            supervise_job(self.out, response.run_id)
        self.assertEqual(get_run(response.run_id)['status'], 'failed')
        self.assertIn('-9', get_run(response.run_id)['error']['message'])
        self.assertFalse(pending.exists())
        self.assertFalse((self.out / '.analysis.lock').exists())

    def test_wrong_token_cannot_release_another_job(self):
        owner = uuid4().hex
        reserve_run(self.out, owner)
        release_run(self.out, uuid4().hex)
        self.assertTrue((self.out / '.analysis.lock').exists())
        release_run(self.out, owner)
        self.assertFalse((self.out / '.analysis.lock').exists())


def multipart(files):
    boundary = 'test-' + uuid4().hex
    parts = []
    for field, filename, data in files:
        parts += [f'--{boundary}\r\nContent-Disposition: form-data; name="{field}"; filename="{filename}"\r\nContent-Type: application/octet-stream\r\n\r\n'.encode(), data, b'\r\n']
    parts.append(f'--{boundary}--\r\n'.encode())
    return b''.join(parts), 'multipart/form-data; boundary=' + boundary


class UploadHTTPTests(unittest.TestCase):
    def tearDown(self):
        # A failed assertion must not leave a worker affecting the next test.
        owner = self.out / '.analysis.lock/owner.json'
        if owner.is_file():
            run_id = json.loads(owner.read_text())['run_id']
            self.wait_for_job(run_id)

    @classmethod
    def setUpClass(cls):
        cls.temporary = TemporaryDirectory()
        cls.addClassCleanup(cls.temporary.cleanup)
        cls.root = Path(cls.temporary.name)
        cls.out = cls.root / 'api-results'
        cls.baseline = run_analysis(DATA_DIR, cls.root / 'cli-results', AnalysisConfig())
        with socket.socket() as listener:
            listener.bind(('127.0.0.1', 0))
            port = listener.getsockname()[1]
        cls.base = f'http://127.0.0.1:{port}'
        cls.log = (cls.root / 'server.log').open('w+b')
        cls.addClassCleanup(cls.log.close)
        cls.process = subprocess.Popen([sys.executable, '-m', 'uvicorn', 'backend.app.main:app',
            '--host', '127.0.0.1', '--port', str(port)], cwd=PROJECT,
            env={**os.environ, 'GRAPH_OUTPUT_DIR': str(cls.out)}, stdin=subprocess.DEVNULL,
            stdout=cls.log, stderr=subprocess.STDOUT)
        cls.addClassCleanup(cls.stop_server)
        until = monotonic() + 15
        while monotonic() < until:
            try:
                with urlopen(cls.base + '/api/health', timeout=1):
                    return
            except (URLError, TimeoutError):
                if cls.process.poll() is not None:
                    break
                sleep(.05)
        cls.log.seek(0)
        raise RuntimeError(cls.log.read().decode())

    @classmethod
    def stop_server(cls):
        cls.process.terminate()
        try:
            cls.process.wait(timeout=15)
        except subprocess.TimeoutExpired:
            cls.process.kill()
            cls.process.wait(timeout=5)

    def request(self, path, data=None, content_type=None):
        request = Request(self.base + path, data=data,
                          headers={'Content-Type': content_type} if content_type else {})
        try:
            response = urlopen(request, timeout=20)
        except HTTPError as error:
            response = error
        with response:
            body = response.read()
            return response.status, dict(response.headers), body

    def get_json(self, path):
        status, _, body = self.request(path)
        return status, json.loads(body)

    def upload(self, overrides=None, omit=(), unsafe_names=False):
        files = []
        for name in ('nodes', 'edges', 'transactions'):
            if name in omit:
                continue
            data = (overrides or {}).get(name, (DATA_DIR / (name + '.parquet')).read_bytes())
            files.append((name, '../../escape.parquet' if unsafe_names else name + '.parquet', data))
        body, content_type = multipart(files)
        status, _, response = self.request('/api/runs', body, content_type)
        return status, json.loads(response)

    def wait_for_job(self, run_id):
        states = []
        until = monotonic() + 20
        while monotonic() < until:
            status, state = self.get_json('/api/runs/' + run_id)
            self.assertEqual(status, 200)
            states.append(state['status'])
            if state['status'] in ('completed', 'failed'):
                # The supervising background task owns final temporary-file cleanup.
                while monotonic() < until:
                    if not (self.out / '.analysis.lock').exists() and not (self.out / 'jobs' / run_id / 'uploads').exists():
                        return state, states
                    sleep(.02)
                break
            sleep(.02)
        self.fail(f'Job did not finish and release resources: {run_id}, {states[-5:]}')

    def test_valid_upload_returns_202_preserves_run_id_and_matches_cli_csvs(self):
        status, accepted = self.upload(unsafe_names=True)
        self.assertEqual(status, 202)
        self.assertEqual(accepted['status'], 'queued')
        run_id = accepted['run_id']
        report, states = self.wait_for_job(run_id)
        self.assertEqual(report['status'], 'completed')
        self.assertTrue(any(s in ('queued', 'running') for s in states))
        self.assertEqual(report['run_id'], run_id)
        self.assertEqual(report['summary']['nodes_count'], 2248)
        self.assertEqual(report['csv_sha256'], self.baseline['csv_sha256'])
        for filename in CSV_FIELDS:
            status, headers, body = self.request(f'/api/runs/{run_id}/exports/{filename}')
            self.assertEqual(status, 200)
            self.assertEqual(headers.get('x-run-id') or headers.get('X-Run-Id'), run_id)
            self.assertEqual(hashlib.sha256(body).hexdigest(), report['csv_sha256'][filename])
        self.assertFalse((self.out / 'jobs/escape.parquet').exists())
        state = read_state(self.out, run_id)
        self.assertNotEqual(state['worker_pid'], self.process.pid)
        self.assertEqual(self.get_json('/api/runs/' + run_id + '/nodes?limit=1')[1]['run_id'], run_id)

    def test_busy_run_and_pending_results_are_409_health_stays_responsive(self):
        status, accepted = self.upload()
        self.assertEqual(status, 202)
        run_id = accepted['run_id']
        started = monotonic()
        self.assertEqual(self.get_json('/api/health')[0], 200)
        self.assertLess(monotonic() - started, 1)
        self.assertEqual(self.get_json('/api/runs/' + run_id + '/nodes')[0], 409)
        status, rejected = self.upload()
        self.assertEqual(status, 409)
        self.assertEqual(rejected['detail']['code'], 'analysis_busy')
        self.assertEqual(self.wait_for_job(run_id)[0]['status'], 'completed')

    def test_missing_fields_are_422_without_creating_job(self):
        for omit in (('nodes',), ('edges',), ('transactions',)):
            status, _ = self.upload(omit=omit)
            self.assertEqual(status, 422)
        self.assertFalse((self.out / '.analysis.lock').exists())

    def test_corrupt_file_fails_and_preserves_previous_success(self):
        status, accepted = self.upload()
        self.assertEqual(status, 202)
        previous = self.wait_for_job(accepted['run_id'])[0]
        old_target = (self.out / 'latest').resolve()
        status, bad = self.upload({'nodes': b'not parquet'})
        self.assertEqual(status, 202)
        failed, _ = self.wait_for_job(bad['run_id'])
        self.assertEqual(failed['status'], 'failed')
        self.assertEqual(failed['failed_stage'], 'validation')
        self.assertIn('nodes.parquet', failed['error']['message'])
        self.assertEqual((self.out / 'latest').resolve(), old_target)
        self.assertEqual(self.request(f"/api/runs/{bad['run_id']}/exports/nodes_roles.csv")[0], 409)
        self.assertEqual(self.get_json('/api/runs/' + previous['run_id'])[1]['status'], 'completed')
        listed = self.get_json('/api/runs')[1]['items']
        self.assertEqual(next(r for r in listed if r['run_id'] == bad['run_id'])['status'], 'failed')

    def test_mismatched_transaction_count_fails_validation(self):
        table = pq.read_table(DATA_DIR / 'edges.parquet')
        counts = table['n_tx'].to_pylist()
        counts[0] += 1
        table = table.set_column(table.column_names.index('n_tx'), 'n_tx', pa.array(counts, type=pa.int64()))
        buffer = io.BytesIO()
        pq.write_table(table, buffer)
        status, accepted = self.upload({'edges': buffer.getvalue()})
        self.assertEqual(status, 202)
        failed, _ = self.wait_for_job(accepted['run_id'])
        self.assertEqual(failed['status'], 'failed')
        self.assertIn('n_tx', failed['error']['message'])

    def test_unknown_runs_and_private_exports_are_not_available(self):
        self.assertEqual(self.get_json('/api/runs/' + uuid4().hex)[0], 404)
        self.assertEqual(self.get_json('/api/runs/not-a-run')[0], 404)
        self.assertEqual(self.get_json('/api/runs/' + uuid4().hex + '/exports/config.json')[0], 404)


if __name__ == '__main__':
    unittest.main()
