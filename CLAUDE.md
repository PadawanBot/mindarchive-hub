# CLAUDE.md - AI Assistant Guide for Mycode Repository

> **Last Updated:** 2026-01-08
> **Purpose:** This document provides AI assistants with essential context about the codebase structure, development workflows, and conventions to follow when working on this repository.

---

## Table of Contents

1. [Repository Overview](#repository-overview)
2. [Codebase Structure](#codebase-structure)
3. [Development Workflows](#development-workflows)
4. [Coding Conventions](#coding-conventions)
5. [AI Assistant Guidelines](#ai-assistant-guidelines)
6. [Common Tasks](#common-tasks)
7. [Troubleshooting](#troubleshooting)

---

## Repository Overview

**Repository:** frozenout00/Mycode
**Current Status:** Initial setup phase
**Primary Purpose:** [To be defined as project develops]

### Key Technologies
- [To be updated as technologies are added]

### Project Goals
- [To be documented as project scope is defined]

---

## Codebase Structure

This repository follows a structured organization pattern. As the codebase grows, this section should be updated to reflect the actual structure.

### Recommended Directory Structure

```
/
├── src/              # Source code
├── tests/            # Test files
├── docs/             # Documentation
├── scripts/          # Build and utility scripts
├── config/           # Configuration files
├── .github/          # GitHub workflows and templates
└── CLAUDE.md         # This file
```

### Key Files and Directories
- **CLAUDE.md**: AI assistant guidelines and codebase documentation
- [To be updated as key files are added]

---

## Development Workflows

### Branch Strategy

This repository uses a feature branch workflow:

1. **Feature Branches**: All development happens on feature branches
   - Branch naming: `claude/[description]-[sessionId]`
   - Example: `claude/add-authentication-xYz12`

2. **Main Branch**: Production-ready code
   - Protected branch (when configured)
   - Requires pull request reviews

3. **Branch Lifecycle**:
   ```bash
   # Create and switch to feature branch
   git checkout -b claude/feature-description-abc123

   # Make changes and commit
   git add .
   git commit -m "Descriptive commit message"

   # Push to remote
   git push -u origin claude/feature-description-abc123

   # Create pull request when ready
   gh pr create --title "Feature: Description" --body "Details..."
   ```

### Commit Message Conventions

Follow these guidelines for commit messages:

- **Format**: `<type>: <description>`
- **Types**:
  - `feat`: New feature
  - `fix`: Bug fix
  - `docs`: Documentation changes
  - `refactor`: Code refactoring
  - `test`: Adding or updating tests
  - `chore`: Maintenance tasks
  - `style`: Code style changes (formatting, etc.)

**Examples:**
```
feat: add user authentication system
fix: resolve memory leak in data processor
docs: update API documentation
refactor: simplify error handling logic
```

### Pull Request Process

1. Ensure all tests pass before creating PR
2. Provide clear description of changes
3. Include test plan or verification steps
4. Reference related issues if applicable
5. Wait for review and address feedback

---

## Coding Conventions

### General Principles

1. **Simplicity First**: Avoid over-engineering
   - Only add features that are explicitly requested
   - Don't add error handling for impossible scenarios
   - Keep code focused on current requirements

2. **Code Quality**:
   - Write self-documenting code
   - Add comments only when logic isn't self-evident
   - Follow DRY (Don't Repeat Yourself) within reason
   - Three similar lines are better than premature abstraction

3. **Security**:
   - Never commit sensitive data (.env, credentials, API keys)
   - Validate all external inputs
   - Be aware of OWASP Top 10 vulnerabilities
   - Use parameterized queries for database operations

### Language-Specific Conventions

[To be updated as primary languages are established]

#### JavaScript/TypeScript
- Use `const` by default, `let` when reassignment needed
- Prefer async/await over raw promises
- Use meaningful variable names
- Follow existing code style in the repository

#### Python
- Follow PEP 8 style guide
- Use type hints where beneficial
- Document complex functions with docstrings
- Use virtual environments for dependencies

#### [Other Languages]
- [To be added as used]

---

## AI Assistant Guidelines

### Core Responsibilities

When working on this repository, AI assistants should:

1. **Read Before Modifying**
   - Always read files before suggesting changes
   - Understand existing patterns and follow them
   - Don't propose changes to code you haven't examined

2. **Use Task Management**
   - Use TodoWrite tool for complex multi-step tasks
   - Keep exactly ONE task in_progress at a time
   - Mark tasks completed immediately after finishing
   - Update todo list when discovering new requirements

3. **Be Conservative**
   - Only make requested changes
   - Don't add unsolicited "improvements"
   - Don't refactor surrounding code unless asked
   - Avoid backwards-compatibility hacks for unused code

4. **Security Awareness**
   - Check for security vulnerabilities in all changes
   - Never introduce SQL injection, XSS, or command injection risks
   - Validate at system boundaries (user input, external APIs)
   - Alert user if they try to commit sensitive files

### Tool Usage Priorities

1. **File Operations**:
   - Use `Read` tool for reading files (not `cat`)
   - Use `Edit` tool for modifications (not `sed/awk`)
   - Use `Write` tool for new files (not `echo >`)

2. **Code Search**:
   - Use `Grep` for content search (not `grep` command)
   - Use `Glob` for file pattern matching (not `find`)
   - Use `Task` tool with Explore agent for open-ended exploration

3. **Git Operations**:
   - Always push to branch starting with `claude/` and ending with session ID
   - Use retry logic for network failures (exponential backoff: 2s, 4s, 8s, 16s)
   - Never push to main/master without explicit permission
   - Use HEREDOC for commit messages to ensure proper formatting

### Code Reference Format

When referencing code, use the format: `file_path:line_number`

**Example:**
```
The authentication logic is in src/auth/login.js:45
```

---

## Common Tasks

### Starting a New Feature

```bash
# 1. Ensure you're on the correct branch
git status

# 2. Create todos for the task
# Use TodoWrite tool to plan steps

# 3. Explore codebase if needed
# Use Task tool with Explore agent for understanding existing code

# 4. Implement changes
# Read files first, then edit or write

# 5. Test changes
# Run tests and verify functionality

# 6. Commit and push
git add .
git commit -m "feat: description of feature"
git push -u origin claude/feature-name-sessionId
```

### Fixing a Bug

```bash
# 1. Reproduce and understand the issue
# Read relevant code and understand the problem

# 2. Create todo list for fix
# Plan the fix steps

# 3. Implement fix
# Make minimal changes to resolve the issue

# 4. Verify fix
# Test that bug is resolved and no regression

# 5. Commit with clear message
git commit -m "fix: description of what was fixed"
```

### Running Tests

[To be updated based on test framework]

```bash
# Run all tests
[command to be added]

# Run specific test file
[command to be added]

# Run with coverage
[command to be added]
```

### Building the Project

[To be updated based on build system]

```bash
# Development build
[command to be added]

# Production build
[command to be added]
```

---

## Troubleshooting

### Common Issues

#### Git Push Failures

**Problem:** Push fails with 403 error

**Solution:** Ensure branch name starts with `claude/` and ends with matching session ID

**Problem:** Network timeout during push

**Solution:** Retry with exponential backoff (implemented automatically in workflow)

#### Merge Conflicts

**Problem:** Conflicts when pulling/merging

**Solution:**
```bash
# Fetch latest changes
git fetch origin

# Merge with strategy
git merge origin/main

# Resolve conflicts manually
# Edit conflicted files, then:
git add .
git commit -m "fix: resolve merge conflicts"
```

#### Test Failures

**Problem:** Tests failing after changes

**Solution:**
1. Read test output carefully
2. Understand what the test expects
3. Fix code or update test if requirements changed
4. Never mark todo as complete with failing tests

---

## Maintenance

This document should be updated:

- When new technologies are added to the project
- When development workflows change
- When new conventions are established
- When common issues and solutions are discovered
- At the start of major feature development
- After significant architectural changes

### Update Checklist

When updating CLAUDE.md:

- [ ] Update "Last Updated" date at the top
- [ ] Ensure all sections are accurate and current
- [ ] Add new sections for new patterns or conventions
- [ ] Remove outdated information
- [ ] Verify all examples still work
- [ ] Update technology stack if changed
- [ ] Document any new common tasks

---

## Additional Resources

### Documentation Links
- [To be added as documentation is created]

### External References
- [Git Best Practices](https://git-scm.com/book/en/v2)
- [Conventional Commits](https://www.conventionalcommits.org/)
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)

### Team Contacts
- [To be added if applicable]

---

## Notes for Future Development

As this project grows, consider adding:

1. **Architecture Documentation**: System design, data flows, component relationships
2. **API Documentation**: Endpoints, request/response formats, authentication
3. **Database Schema**: Tables, relationships, migrations
4. **Deployment Guide**: How to deploy to various environments
5. **Environment Setup**: Required tools, dependencies, configuration
6. **Performance Guidelines**: Benchmarks, optimization strategies
7. **Accessibility Standards**: WCAG compliance, testing procedures
8. **Internationalization**: i18n strategy, supported locales

---

*This document is a living guide. Keep it updated as the project evolves.*
