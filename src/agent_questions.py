"""Fixed native question transport, evaluated inside the existing agent helper.

No guessing numeric shortcuts, no shell typing, no approval decisions. One
explicit answer controls one recognized single-question/single-select dialog.
"""
def answer_question(request, initial):
    started = False
    buffer = None
    try:
        frozen = input_question(initial)
        if (not frozen or not frozen['supported'] or initial['identity'] != request.get('identity')
                or initial['screen'] != request.get('screen') or frozen['id'] != request.get('menu_id')):
            fail(409, 'Question or agent changed; refresh and review')
        choice = request.get('choice')
        text = request.get('text')
        target = frozen['other'] if choice == 'other' else choice
        if choice == 'other':
            if (not isinstance(text, str) or not text or text != text.strip()
                    or len(text.encode()) > 512 or any(ord(c) < 32 or ord(c) == 127 for c in text)):
                fail(400, 'Other answer must be bounded single-line text without control characters or edge whitespace')
        elif text is not None or choice not in [c['id'] for c in frozen['choices']]:
            fail(400, 'Unsupported question answer')

        def verify(observation, pasted=False):
            if observation['identity'] != request['identity'] or observation['in_mode']:
                fail(409, 'Agent changed during question response')
            candidates = [c for c in conversations(observation) if c.get('linked')]
            if len(candidates) != 1 or candidates[0]['id'] != request.get('conversation'):
                fail(409, 'Original question conversation changed')
            displayed = observation
            if pasted:
                # Answers are limited to one visible row, so literal read-back
                # is exact rather than whitespace-folded or substring matching.
                lines = observation['visible'].rstrip().splitlines()
                matches = [(i,re.fullmatch(r'\s*([›❯>])?\s*'+re.escape(frozen['other'])+r'[.)]\s+(.+?)\s*',line)) for i,line in enumerate(lines)]
                matches = [(i,m) for i,m in matches if m]
                if len(matches)!=1 or not matches[0][1].group(1) or matches[0][1].group(2)!=text:
                    fail(409, 'Native answer text could not be verified')
                i,m=matches[0]
                lines[i]=m.group(1)+' '+frozen['other']+'. Type something.'
                displayed=dict(observation,visible='\n'.join(lines))
            menu=input_question(displayed)
            if not menu or not menu['supported'] or menu['id']!=frozen['id']:
                fail(409, 'Question changed during response')
            return menu

        def width_check():
            if choice=='other':
                width=int(tmux(request,'display-message','-p','-t',initial['target'],'#{pane_width}').strip())
                if len(text.encode())>min(512,max(0,width-12)):
                    fail(400, 'Other answer is too long for exact native read-back; shorten it or use the terminal')

        verify(initial)
        if (question_request_id(initial,frozen)!=request.get('request_id')
                or hashlib.sha256((frozen['id']+'/'+request['request_id']).encode()).hexdigest()!=request.get('question_id')):
            fail(409,'Original pending native question call changed')
        width_check()
        current=observe(request)
        menu=verify(current)
        if current['screen']!=initial['screen']:
            fail(409, 'Terminal changed before response')
        for _ in range(9):
            position=int(menu['selected'])
            if position==int(target):break
            direction=1 if int(target)>position else -1
            fresh=observe(request)
            fresh_menu=verify(fresh)
            if fresh['screen']!=current['screen'] or fresh_menu['selected']!=menu['selected']:
                fail(409,'Question selection changed')
            started=True
            tmux(request,'send-keys','-t',initial['target'],'Down' if direction>0 else 'Up')
            expected=str(position+direction)
            for _ in range(10):
                time.sleep(.025)
                current=observe(request)
                menu=verify(current)
                if menu['selected']==expected:break
                if menu['selected']!=str(position):fail(409,'Unexpected native question selection')
            else:fail(409,'Native question navigation could not be confirmed')
        else:fail(409,'Question navigation exceeded its bound')
        fresh=observe(request)
        menu=verify(fresh)
        if menu['selected']!=str(target) or fresh['screen']!=current['screen']:
            fail(409,'Question changed before answer')
        if choice=='other':
            width_check()
            buffer='cc-question-'+uuid.uuid4().hex
            tmux(request,'load-buffer','-b',buffer,'-',input=text.encode())
            current=observe(request)
            if current['screen']!=fresh['screen'] or verify(current)['selected']!=str(target):
                fail(409,'Question changed before answer paste')
            started=True
            tmux(request,'paste-buffer','-p','-d','-b',buffer,'-t',initial['target'])
            for _ in range(10):
                time.sleep(.025)
                current=observe(request)
                try:
                    verify(current,pasted=True)
                    break
                except Failure:
                    # A renderer may not yet have painted the paste. Only an
                    # unchanged process is polled; no key or paste is repeated.
                    if current['identity']!=request['identity']:raise
            else:fail(409,'Native pasted answer could not be confirmed')
            fresh=observe(request)
            verify(fresh,pasted=True)
            if fresh['screen']!=current['screen']:fail(409,'Answer changed before submission')
        if question_request_id(fresh,frozen)!=request.get('request_id'):
            fail(409,'Pending question call changed before final submission')
        # Exactly one Enter, after a fresh identity/conversation/prompt/text check.
        started=True
        tmux(request,'send-keys','-t',initial['target'],'Enter')
        return dict(submitted=True)
    except (Failure,OSError,ValueError,subprocess.SubprocessError) as error:
        if started:
            fail(502,'Question response is uncertain. Check the terminal; no automatic retry is allowed.')
        if isinstance(error,Failure):
            return dict(submitted=False,not_sent=True,reason=error.message)
        fail(502,'Question response could not be verified; inspect its receipt before responding again')
    finally:
        if buffer:
            try:tmux(request,'delete-buffer','-b',buffer)
            except Failure:pass
