# Changelog

<!--
How to release a new version:
1. Update your code files.
2. Add a new section at the TOP of this list, written exactly like:
   ## v1.5.0 – Short title
   - what changed
3. Change "version" in package.json to the same number (1.5.0). That starts the auto release.
-->

## v1.4.0 – Mid / Final / All files
- After choosing a course, students pick Mid, Final or All files
- New `exam` column (I) in the files tab; files without it show under All files
- Captions can include the exam: `CSE | Summer 2026 | CSE 113 | Mid | Lecture 1`
- 4-part captions still work, and the bot asks Mid or Final
- `/batch` asks for the exam once
- Duplicate check includes the exam

## v1.3.0 – Bangladesh time and report checkbox
- All timestamps use Bangladesh time (GMT+6)
- Each report in the reports tab gets a done checkbox

## v1.2.0 – Reports
- `/report your message` for missing files, saved in the reports tab
- Limit of 3 reports per student per hour (limits tab)
- Updated welcome, help and about texts

## v1.1.0 – Batch upload
- `/batch` mode for uploading several files into one course
- A title question for each file, with the file name as a suggestion

## v1.0.0 – First version
- Menu: department → semester → course → files
- Admin upload with a caption or with buttons
- Private channel mode and automatic backup copies
- Duplicate check
