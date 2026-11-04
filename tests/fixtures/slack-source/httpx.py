class Timeout:
    def __init__(self,*args,**kwargs): pass
class HTTPStatusError(Exception):
    def __init__(self):
        self.response=type('Response',(),{'status_code':429,'headers':{'retry-after':'1'}})()
        super().__init__('FAKE_AUTH_SECRET must never leave the source')
