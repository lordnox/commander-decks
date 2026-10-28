import os
import unittest
from unittest.mock import patch

import area_labels as areas
from check_pr_title import check_pr_title


def item(labels=(), **fields):
    return {'title': 'server: persist game events', 'labels': [{'name': label} for label in labels],
            'state': 'open', **fields}


class AreaLabelsTest(unittest.TestCase):
    def setUp(self):
        output = patch("builtins.print")
        output.start()
        self.addCleanup(output.stop)

    def test_pr_requires_title_area_even_with_another_area(self):
        self.assertIsNotNone(areas.label_error(item(['bug']), pull_request=True))
        self.assertIn('`server`', areas.label_error(item(['site']), pull_request=True))
        self.assertIsNone(areas.label_error(item(['server', 'site']), pull_request=True))
        for area in areas.AREAS:
            self.assertIsNone(check_pr_title(f'{area}: describe the change'))
            self.assertIsNone(areas.label_error(item([area], title=f'{area}: describe the change'), pull_request=True))

    def test_issues_do_not_require_title_prefixes(self):
        self.assertIsNone(areas.label_error(item(['dsl'], title='Remove legacy effects')))
        self.assertIsNotNone(areas.label_error(item(['enhancement'])))

    def test_form_only_reads_exact_known_areas_from_area_section(self):
        self.assertEqual(areas.selected_areas('### Area\n\nserver, site\n\n### Problem or goal\n\ndsl'), ['server', 'site'])
        self.assertEqual(areas.selected_areas('### Area\n\nunknown, bug, dsl'), ['dsl'])
        self.assertEqual(areas.selected_areas('server, site'), [])
        self.assertEqual(areas.selected_areas(None), [])

    @patch.dict(os.environ, {'GITHUB_REPOSITORY': 'owner/repo'})
    @patch.object(areas, 'api')
    def test_opened_form_adds_labels_then_reads_current_state(self, api):
        api.side_effect = [item(body='### Area\n\nserver, site'), {}, item(['server', 'site']), []]
        areas.check_issue(1, 'opened')
        self.assertEqual(api.call_args_list[1].args, ('issues/1/labels', 'POST', {'labels': ['server', 'site']}))
        self.assertEqual(api.call_count, 4)

    @patch.dict(os.environ, {'GITHUB_REPOSITORY': 'owner/repo'})
    @patch.object(areas, 'api')
    def test_removing_label_does_not_restore_form_selection(self, api):
        api.side_effect = [item(body='### Area\n\nserver'), [], {}]
        areas.check_issue(1, 'unlabeled')
        path, method, payload = api.call_args.args
        self.assertEqual((path, method), ('issues/1/comments', 'POST'))
        self.assertIn('Add at least one area label', payload['body'])

    @patch.dict(os.environ, {'GITHUB_REPOSITORY': 'owner/repo'})
    @patch.object(areas, 'api')
    def test_reuses_bot_comment_after_pagination_and_marks_resolved(self, api):
        human = {'user': {'login': 'human'}, 'body': areas.COMMENT_MARKER, 'id': 1}
        bot = {'user': {'login': 'github-actions[bot]'}, 'body': areas.COMMENT_MARKER, 'id': 2}
        api.side_effect = [item(['rules']), [human] * 100, [bot], {}]
        areas.check_issue(1, 'labeled')
        path, method, payload = api.call_args.args
        self.assertEqual((path, method), ('issues/comments/2', 'PATCH'))
        self.assertIn('check passed', payload['body'])

    @patch.dict(os.environ, {'GITHUB_REPOSITORY': 'owner/repo'})
    @patch.object(areas, 'api')
    def test_unchanged_diagnostic_is_not_posted_again(self, api):
        api.side_effect = [item(), [], {}]
        areas.check_issue(1, 'reopened')
        body = api.call_args.args[2]['body']
        api.reset_mock()
        api.side_effect = [item(), [{'user': {'login': 'github-actions[bot]'}, 'body': body, 'id': 2}]]
        areas.check_issue(1, 'reopened')
        self.assertEqual(api.call_count, 2)

    @patch.object(areas, 'api')
    def test_ignores_closed_issues_and_prs(self, api):
        for fields in ({'state': 'closed'}, {'pull_request': {}}):
            api.reset_mock()
            api.side_effect = [item(**fields)]
            areas.check_issue(1, 'labeled')
            self.assertEqual(api.call_count, 1)

    @patch.object(areas, 'api')
    def test_pr_reads_live_metadata(self, api):
        api.return_value = item(['server'])
        self.assertEqual(areas.check_pull_request(1), 0)
        api.assert_called_once_with('issues/1')
        api.return_value = item(['dsl'])
        self.assertEqual(areas.check_pull_request(1), 1)


if __name__ == '__main__':
    unittest.main()
