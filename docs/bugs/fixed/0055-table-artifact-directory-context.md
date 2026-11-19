# Bug0055: Table filenames ignore explicitly introduced artifact folder

Found2026-11-18 on CC-112. Assistant says clips are in `~/.cache/cc112/clips/`, immediately followed by a table of bare MP3 filenames. Files exist in that directory; current resolver has only full-file/same-folder hints, so filename buttons target the project directory and download404. Scope any repair to one unambiguous explicit table-introducing directory; do not search filesystem or infer from unrelated message directories.

Fixed2026-11-18 in task0133. Table links now take an unambiguous absolute/home-relative directory explicitly introduced in the immediately preceding paragraph. Existing absolute links and path guards retained; ambiguous/detached references keep project resolution.18 browser cases pass, including actual download bytes and negative contexts. Live read-only path checks confirm9 correct MP3 paths return200 and the incorrect project path404. Frontend not deployed yet.
